-- jword v1 mutation functions.
--
-- Every logical mutation is one transaction: primary rows, activity, version bump,
-- last_activity_at, and the retry receipt commit or roll back together (decisions 002, 007,
-- 008, 009). Privileged helpers live in the private `jword` schema; the public wrappers are the
-- only functions web/MCP callers may execute (decision 010).
--
-- Error contract (read by the TypeScript repository):
--   SQLSTATE JW401 UNAUTHENTICATED, JW403 FORBIDDEN, JW404 NOT_FOUND, JW409 CONFLICT,
--   JW422 VALIDATION_ERROR, JW42I IMPORT_ROW_ERROR. HINT carries a reason
--   (STALE_VERSION, REQUEST_ID_REUSED, DUPLICATE_CANDIDATES, ...), DETAIL carries JSON.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function jword.fail(p_code text, p_message text, p_reason text default null, p_detail jsonb default null)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = p_code,
    message = p_message,
    hint = coalesce(p_reason, ''),
    detail = coalesce(p_detail::text, '');
end;
$$;

-- Same contract as normalizeName() in packages/core (decision 013): trim, collapse whitespace,
-- lowercase. Punctuation and suffixes are preserved.
create or replace function jword.normalize_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '\s+', ' ', 'g'));
$$;

-- Resolve the owner for a call. Authenticated web sessions must match auth.uid(); the local
-- service-role connector (no session identity) must supply the configured owner explicitly.
create or replace function jword.resolve_owner(p_owner_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text := auth.role();
begin
  if v_uid is not null then
    if p_owner_id is not null and p_owner_id <> v_uid then
      perform jword.fail('JW403', 'Owner does not match the authenticated session.', 'OWNER_MISMATCH');
    end if;
    return v_uid;
  end if;

  if v_role = 'service_role' or session_user = 'postgres' then
    if p_owner_id is null then
      perform jword.fail('JW422', 'An owner id is required for privileged callers.', 'OWNER_REQUIRED');
    end if;
    return p_owner_id;
  end if;

  perform jword.fail('JW401', 'Authentication is required.', 'NO_SESSION');
  return null;
end;
$$;

create or replace function jword.parse_actor(p_actor text)
returns public.actor_type
language plpgsql
set search_path = ''
as $$
begin
  return p_actor::public.actor_type;
exception when invalid_text_representation then
  perform jword.fail('JW422', 'Unknown actor type.', 'INVALID_ACTOR');
  return null;
end;
$$;

create or replace function jword.parse_status(p_value text)
returns public.application_status
language plpgsql
set search_path = ''
as $$
begin
  return p_value::public.application_status;
exception when invalid_text_representation then
  perform jword.fail('JW422', format('Unknown status "%s".', p_value), 'INVALID_STATUS');
  return null;
end;
$$;

create or replace function jword.parse_priority(p_value text)
returns public.application_priority
language plpgsql
set search_path = ''
as $$
begin
  return p_value::public.application_priority;
exception when invalid_text_representation then
  perform jword.fail('JW422', format('Unknown priority "%s".', p_value), 'INVALID_PRIORITY');
  return null;
end;
$$;

create or replace function jword.parse_arrangement(p_value text)
returns public.work_arrangement
language plpgsql
set search_path = ''
as $$
begin
  return p_value::public.work_arrangement;
exception when invalid_text_representation then
  perform jword.fail('JW422', format('Unknown work arrangement "%s".', p_value), 'INVALID_WORK_ARRANGEMENT');
  return null;
end;
$$;

create or replace function jword.parse_date(p_value text, p_field text)
returns date
language plpgsql
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    perform jword.fail('JW422', format('%s must be an ISO date (YYYY-MM-DD).', p_field), 'INVALID_DATE');
  end if;
  return p_value::date;
exception when invalid_datetime_format or datetime_field_overflow then
  perform jword.fail('JW422', format('%s is not a valid calendar date.', p_field), 'INVALID_DATE');
  return null;
end;
$$;

create or replace function jword.parse_timestamp(p_value text, p_field text)
returns timestamptz
language plpgsql
set search_path = ''
as $$
begin
  if p_value is null or btrim(p_value) = '' then
    return null;
  end if;
  return p_value::timestamptz;
exception when invalid_datetime_format or datetime_field_overflow then
  perform jword.fail('JW422', format('%s is not a valid timestamp.', p_field), 'INVALID_TIMESTAMP');
  return null;
end;
$$;

-- Trimmed text or null when blank/absent.
create or replace function jword.clean_text(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_value is null or btrim(p_value) = '' then null else btrim(p_value) end;
$$;

-- Retry receipts (decision 009). Serializes concurrent attempts with the same request id and
-- returns the committed result of an identical earlier attempt.
create or replace function jword.begin_request(p_owner_id uuid, p_request_id uuid, p_operation text, p_fingerprint text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_receipt public.mutation_requests%rowtype;
begin
  if p_request_id is null then
    perform jword.fail('JW422', 'A request id is required.', 'REQUEST_ID_REQUIRED');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_owner_id::text || ':' || p_request_id::text));
  select * into v_receipt
  from public.mutation_requests
  where user_id = p_owner_id and request_id = p_request_id;
  if found then
    if v_receipt.operation <> p_operation or v_receipt.input_hash <> p_fingerprint then
      perform jword.fail('JW409', 'This request id was already used for a different command.', 'REQUEST_ID_REUSED');
    end if;
    return v_receipt.result || jsonb_build_object('replayed', true);
  end if;
  return null;
end;
$$;

create or replace function jword.finish_request(p_owner_id uuid, p_request_id uuid, p_operation text, p_fingerprint text, p_result jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  insert into public.mutation_requests (user_id, request_id, operation, input_hash, result)
  values (p_owner_id, p_request_id, p_operation, p_fingerprint, p_result);
  return p_result || jsonb_build_object('replayed', false);
end;
$$;

create or replace function jword.fingerprint(p_operation text, p_actor text, p_command jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(p_operation || '|' || coalesce(p_actor, '') || '|' || p_command::text);
$$;

-- Duplicate candidates (decision 006): same normalized company + title, same job URL, or same
-- external id within the same company. Returns a small JSON array; never merges anything.
create or replace function jword.find_duplicates(
  p_owner_id uuid, p_normalized_company text, p_normalized_title text, p_job_url text, p_external_job_id text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  from (
    select
      o.application_id as "applicationId",
      o.company_name as "company",
      o.title,
      o.status::text as "status",
      array_remove(array[
        case when o.company_normalized_name = p_normalized_company and o.normalized_title = p_normalized_title then 'company_title' end,
        case when p_job_url is not null and o.job_url = p_job_url then 'job_url' end,
        case when p_external_job_id is not null and o.external_job_id = p_external_job_id
              and o.company_normalized_name = p_normalized_company then 'external_job_id' end
      ], null) as "matchedOn"
    from public.application_overview o
    where o.user_id = p_owner_id
      and (
        (o.company_normalized_name = p_normalized_company and o.normalized_title = p_normalized_title)
        or (p_job_url is not null and o.job_url = p_job_url)
        or (p_external_job_id is not null and o.external_job_id = p_external_job_id
            and o.company_normalized_name = p_normalized_company)
      )
    order by o.last_activity_at desc
    limit 5
  ) x;
$$;

-- Company match-or-create (decision 013). An explicit company id must belong to the owner.
create or replace function jword.resolve_company(p_owner_id uuid, p_name text, p_company_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_name text := jword.clean_text(p_name);
  v_normalized text;
  v_id uuid;
begin
  if p_company_id is not null then
    select id into v_id from public.companies where user_id = p_owner_id and id = p_company_id;
    if v_id is null then
      perform jword.fail('JW404', 'Selected company was not found.', 'COMPANY_NOT_FOUND');
    end if;
    return v_id;
  end if;

  if v_name is null then
    perform jword.fail('JW422', 'Company name is required.', 'COMPANY_REQUIRED');
  end if;
  v_normalized := jword.normalize_name(v_name);

  insert into public.companies (user_id, name, normalized_name)
  values (p_owner_id, v_name, v_normalized)
  on conflict (user_id, normalized_name) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.companies
    where user_id = p_owner_id and normalized_name = v_normalized;
  end if;
  return v_id;
end;
$$;

-- Lock the application row, verify ownership, and enforce the expected version (decision 008).
create or replace function jword.lock_application(p_owner_id uuid, p_application_id uuid, p_expected_version integer)
returns public.applications
language plpgsql
set search_path = ''
as $$
declare
  v_app public.applications%rowtype;
begin
  if p_application_id is null then
    perform jword.fail('JW422', 'An application id is required.', 'APPLICATION_ID_REQUIRED');
  end if;
  select * into v_app from public.applications
  where user_id = p_owner_id and id = p_application_id
  for update;
  if not found then
    perform jword.fail('JW404', 'Application not found.', 'APPLICATION_NOT_FOUND');
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    perform jword.fail('JW422', 'expectedVersion must be a positive integer.', 'EXPECTED_VERSION_REQUIRED');
  end if;
  if v_app.version <> p_expected_version then
    perform jword.fail(
      'JW409',
      'This application changed since you opened it. Refresh before saving.',
      'STALE_VERSION',
      jsonb_build_object('currentVersion', v_app.version, 'expectedVersion', p_expected_version)
    );
  end if;
  return v_app;
end;
$$;

-- Shared creation core used by create_application and import_applications.
-- Returns {applicationId, jobId, companyId, noteId, activityId, status, priority, dateFound, appliedAt}.
create or replace function jword.create_tracked_job(
  p_owner_id uuid,
  p_actor public.actor_type,
  p_command jsonb,
  p_today date,
  p_activity_type public.activity_type,
  p_activity_metadata jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_title text := jword.clean_text(p_command->>'title');
  v_company_name text := jword.clean_text(p_command->>'company');
  v_company_id uuid;
  v_status public.application_status := coalesce(jword.parse_status(p_command->>'status'), 'SAVED');
  v_priority public.application_priority := coalesce(jword.parse_priority(p_command->>'priority'), 'MEDIUM');
  v_arrangement public.work_arrangement := coalesce(jword.parse_arrangement(p_command->>'workArrangement'), 'UNKNOWN');
  v_job_url text := jword.clean_text(p_command->>'jobUrl');
  v_external_id text := jword.clean_text(p_command->>'externalJobId');
  v_date_found date;
  v_applied_at date;
  v_job_id uuid;
  v_app_id uuid;
  v_note_id uuid;
  v_activity_id uuid;
  v_note text := p_command->>'initialNote';
  v_candidates jsonb;
  v_allow_duplicate boolean := coalesce((p_command->>'allowDuplicate')::boolean, false);
begin
  if v_title is null then
    perform jword.fail('JW422', 'Job title is required.', 'TITLE_REQUIRED');
  end if;
  if v_company_name is null and (p_command->>'companyId') is null then
    perform jword.fail('JW422', 'Company name is required.', 'COMPANY_REQUIRED');
  end if;

  -- Dates: an absent key receives the interactive default (p_today, null for imports);
  -- an explicit null stays blank (decision 011).
  if p_command ? 'dateFound' then
    v_date_found := jword.parse_date(p_command->>'dateFound', 'dateFound');
  else
    v_date_found := p_today;
  end if;
  if p_command ? 'appliedAt' then
    v_applied_at := jword.parse_date(p_command->>'appliedAt', 'appliedAt');
  elsif v_status = 'APPLIED' then
    v_applied_at := p_today;
  end if;

  -- Company is resolved first so duplicate matching uses the stored normalized name.
  v_company_id := jword.resolve_company(p_owner_id, v_company_name, (p_command->>'companyId')::uuid);
  select normalized_name into v_company_name from public.companies where id = v_company_id and user_id = p_owner_id;

  if not v_allow_duplicate then
    v_candidates := jword.find_duplicates(p_owner_id, v_company_name, jword.normalize_name(v_title), v_job_url, v_external_id);
    if jsonb_array_length(v_candidates) > 0 then
      perform jword.fail(
        'JW409',
        'A similar application already exists. Confirm to create a separate application.',
        'DUPLICATE_CANDIDATES',
        jsonb_build_object('candidates', v_candidates)
      );
    end if;
  end if;

  insert into public.jobs (
    user_id, company_id, title, normalized_title, job_url, external_job_id, location,
    work_arrangement, description, date_posted, source
  ) values (
    p_owner_id, v_company_id, v_title, jword.normalize_name(v_title), v_job_url, v_external_id,
    jword.clean_text(p_command->>'location'), v_arrangement, jword.clean_text(p_command->>'description'),
    jword.parse_date(p_command->>'datePosted', 'datePosted'), jword.clean_text(p_command->>'source')
  ) returning id into v_job_id;

  insert into public.applications (
    user_id, job_id, status, priority, date_found, applied_at, resume_version, referral
  ) values (
    p_owner_id, v_job_id, v_status, v_priority, v_date_found, v_applied_at,
    jword.clean_text(p_command->>'resumeVersion'), jword.clean_text(p_command->>'referral')
  ) returning id into v_app_id;

  if v_note is not null and btrim(v_note) <> '' then
    insert into public.application_notes (user_id, application_id, body)
    values (p_owner_id, v_app_id, v_note)
    returning id into v_note_id;
  end if;

  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata)
  values (
    p_owner_id, v_app_id, p_activity_type, p_actor,
    case when p_activity_type = 'IMPORTED' then 'Imported from CSV' else 'Application created' end,
    coalesce(p_activity_metadata, '{}'::jsonb) || jsonb_build_object(
      'status', v_status::text, 'priority', v_priority::text, 'noteId', v_note_id
    )
  ) returning id into v_activity_id;

  return jsonb_build_object(
    'applicationId', v_app_id,
    'jobId', v_job_id,
    'companyId', v_company_id,
    'noteId', v_note_id,
    'activityId', v_activity_id,
    'status', v_status::text,
    'priority', v_priority::text,
    'dateFound', v_date_found::text,
    'appliedAt', v_applied_at::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers (the only functions web and MCP callers may execute)
-- ---------------------------------------------------------------------------

create or replace function public.create_application(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'create_application';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_created jsonb;
  v_result jsonb;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  v_created := jword.create_tracked_job(v_owner, v_actor, p_command, p_today, 'CREATED', '{}'::jsonb);

  v_result := jsonb_build_object(
    'ok', true,
    'operation', v_op,
    'requestId', p_request_id,
    'noop', false,
    'applicationId', v_created->'applicationId',
    'jobId', v_created->'jobId',
    'companyId', v_created->'companyId',
    'noteId', v_created->'noteId',
    'activityId', v_created->'activityId',
    'version', 1,
    'summary', format('Created %s application at %s', v_created->>'status', jword.clean_text(p_command->>'company')),
    'changedFields', jsonb_build_array('status', 'priority', 'dateFound', 'appliedAt'),
    'before', '{}'::jsonb,
    'after', jsonb_build_object(
      'status', v_created->'status', 'priority', v_created->'priority',
      'dateFound', v_created->'dateFound', 'appliedAt', v_created->'appliedAt'
    )
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;

create or replace function public.update_application_status(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'update_application_status';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_app public.applications%rowtype;
  v_new_status public.application_status;
  v_new_applied date;
  v_status_changed boolean;
  v_applied_changed boolean;
  v_occurred timestamptz;
  v_activity_id uuid;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_result jsonb;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  v_app := jword.lock_application(v_owner, (p_command->>'applicationId')::uuid, (p_command->>'expectedVersion')::integer);
  v_new_status := jword.parse_status(p_command->>'status');
  if v_new_status is null then
    perform jword.fail('JW422', 'A status is required.', 'STATUS_REQUIRED');
  end if;
  v_occurred := coalesce(jword.parse_timestamp(p_command->>'occurredAt', 'occurredAt'), now());

  v_status_changed := v_new_status <> v_app.status;

  if p_command ? 'appliedAt' then
    v_new_applied := jword.parse_date(p_command->>'appliedAt', 'appliedAt');
  elsif v_status_changed and v_new_status = 'APPLIED' and v_app.applied_at is null then
    v_new_applied := p_today;
  else
    v_new_applied := v_app.applied_at;
  end if;
  v_applied_changed := v_new_applied is distinct from v_app.applied_at;

  if not v_status_changed and not v_applied_changed then
    v_result := jsonb_build_object(
      'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', true,
      'applicationId', v_app.id, 'version', v_app.version,
      'summary', format('Status is already %s; nothing changed.', v_app.status),
      'changedFields', '[]'::jsonb, 'before', '{}'::jsonb, 'after', '{}'::jsonb
    );
    return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
  end if;

  if v_status_changed then
    v_changed := v_changed || '"status"'::jsonb;
    v_before := v_before || jsonb_build_object('status', v_app.status::text);
    v_after := v_after || jsonb_build_object('status', v_new_status::text);
  end if;
  if v_applied_changed then
    v_changed := v_changed || '"appliedAt"'::jsonb;
    v_before := v_before || jsonb_build_object('appliedAt', v_app.applied_at::text);
    v_after := v_after || jsonb_build_object('appliedAt', v_new_applied::text);
  end if;

  update public.applications
  set status = v_new_status,
      applied_at = v_new_applied,
      version = version + 1,
      last_activity_at = now()
  where id = v_app.id and user_id = v_owner;

  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata, occurred_at)
  values (
    v_owner, v_app.id,
    (case when v_status_changed then 'STATUS_CHANGED' else 'DETAILS_UPDATED' end)::public.activity_type,
    v_actor,
    case
      when v_status_changed then format('Status changed from %s to %s', v_app.status, v_new_status)
      else 'Applied date updated'
    end,
    jsonb_build_object('fields', v_changed, 'before', v_before, 'after', v_after),
    v_occurred
  ) returning id into v_activity_id;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'version', v_app.version + 1, 'activityId', v_activity_id,
    'summary', case
      when v_status_changed then format('Status changed from %s to %s', v_app.status, v_new_status)
      else 'Applied date updated' end,
    'changedFields', v_changed, 'before', v_before, 'after', v_after
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;

create or replace function public.update_application_details(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'update_application_details';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_app public.applications%rowtype;
  v_job public.jobs%rowtype;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_app_changed boolean := false;
  v_job_changed boolean := false;
  v_activity_id uuid;
  v_result jsonb;
  -- new values
  v_priority public.application_priority;
  v_applied_at date;
  v_date_found date;
  v_resume text;
  v_referral text;
  v_title text;
  v_job_url text;
  v_external_id text;
  v_location text;
  v_arrangement public.work_arrangement;
  v_source text;
  v_description text;
  v_date_posted date;
  v_company_id uuid;
  v_company_name text;
  v_old_company_name text;
  v_field_count integer := 0;
  v_allowed text[] := array[
    'priority','appliedAt','dateFound','resumeVersion','referral','title','jobUrl','externalJobId',
    'location','workArrangement','source','description','datePosted','company','companyId'
  ];
  v_key text;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  v_app := jword.lock_application(v_owner, (p_command->>'applicationId')::uuid, (p_command->>'expectedVersion')::integer);
  select * into v_job from public.jobs where id = v_app.job_id and user_id = v_owner for update;

  for v_key in select jsonb_object_keys(p_command) loop
    if v_key = any (v_allowed) then
      v_field_count := v_field_count + 1;
    elsif v_key not in ('applicationId', 'expectedVersion') then
      perform jword.fail('JW422', format('Field "%s" cannot be edited.', v_key), 'FIELD_NOT_ALLOWED');
    end if;
  end loop;
  if v_field_count = 0 then
    perform jword.fail('JW422', 'No editable fields were supplied.', 'EMPTY_UPDATE');
  end if;

  -- Application fields -------------------------------------------------------
  v_priority := coalesce(jword.parse_priority(p_command->>'priority'), v_app.priority);
  if v_priority <> v_app.priority then
    v_app_changed := true; v_changed := v_changed || '"priority"'::jsonb;
    v_before := v_before || jsonb_build_object('priority', v_app.priority::text);
    v_after := v_after || jsonb_build_object('priority', v_priority::text);
  end if;

  v_applied_at := case when p_command ? 'appliedAt' then jword.parse_date(p_command->>'appliedAt', 'appliedAt') else v_app.applied_at end;
  if v_applied_at is distinct from v_app.applied_at then
    v_app_changed := true; v_changed := v_changed || '"appliedAt"'::jsonb;
    v_before := v_before || jsonb_build_object('appliedAt', v_app.applied_at::text);
    v_after := v_after || jsonb_build_object('appliedAt', v_applied_at::text);
  end if;

  v_date_found := case when p_command ? 'dateFound' then jword.parse_date(p_command->>'dateFound', 'dateFound') else v_app.date_found end;
  if v_date_found is distinct from v_app.date_found then
    v_app_changed := true; v_changed := v_changed || '"dateFound"'::jsonb;
    v_before := v_before || jsonb_build_object('dateFound', v_app.date_found::text);
    v_after := v_after || jsonb_build_object('dateFound', v_date_found::text);
  end if;

  v_resume := case when p_command ? 'resumeVersion' then jword.clean_text(p_command->>'resumeVersion') else v_app.resume_version end;
  if v_resume is distinct from v_app.resume_version then
    v_app_changed := true; v_changed := v_changed || '"resumeVersion"'::jsonb;
    v_before := v_before || jsonb_build_object('resumeVersion', v_app.resume_version);
    v_after := v_after || jsonb_build_object('resumeVersion', v_resume);
  end if;

  v_referral := case when p_command ? 'referral' then jword.clean_text(p_command->>'referral') else v_app.referral end;
  if v_referral is distinct from v_app.referral then
    v_app_changed := true; v_changed := v_changed || '"referral"'::jsonb;
    v_before := v_before || jsonb_build_object('referral', v_app.referral);
    v_after := v_after || jsonb_build_object('referral', v_referral);
  end if;

  -- Job fields ---------------------------------------------------------------
  v_title := case when p_command ? 'title' then jword.clean_text(p_command->>'title') else v_job.title end;
  if v_title is null then
    perform jword.fail('JW422', 'Job title cannot be blank.', 'TITLE_REQUIRED');
  end if;
  if v_title <> v_job.title then
    v_job_changed := true; v_changed := v_changed || '"title"'::jsonb;
    v_before := v_before || jsonb_build_object('title', v_job.title);
    v_after := v_after || jsonb_build_object('title', v_title);
  end if;

  v_job_url := case when p_command ? 'jobUrl' then jword.clean_text(p_command->>'jobUrl') else v_job.job_url end;
  if v_job_url is distinct from v_job.job_url then
    v_job_changed := true; v_changed := v_changed || '"jobUrl"'::jsonb;
    v_before := v_before || jsonb_build_object('jobUrl', v_job.job_url);
    v_after := v_after || jsonb_build_object('jobUrl', v_job_url);
  end if;

  v_external_id := case when p_command ? 'externalJobId' then jword.clean_text(p_command->>'externalJobId') else v_job.external_job_id end;
  if v_external_id is distinct from v_job.external_job_id then
    v_job_changed := true; v_changed := v_changed || '"externalJobId"'::jsonb;
    v_before := v_before || jsonb_build_object('externalJobId', v_job.external_job_id);
    v_after := v_after || jsonb_build_object('externalJobId', v_external_id);
  end if;

  v_location := case when p_command ? 'location' then jword.clean_text(p_command->>'location') else v_job.location end;
  if v_location is distinct from v_job.location then
    v_job_changed := true; v_changed := v_changed || '"location"'::jsonb;
    v_before := v_before || jsonb_build_object('location', v_job.location);
    v_after := v_after || jsonb_build_object('location', v_location);
  end if;

  v_arrangement := coalesce(jword.parse_arrangement(p_command->>'workArrangement'), v_job.work_arrangement);
  if v_arrangement <> v_job.work_arrangement then
    v_job_changed := true; v_changed := v_changed || '"workArrangement"'::jsonb;
    v_before := v_before || jsonb_build_object('workArrangement', v_job.work_arrangement::text);
    v_after := v_after || jsonb_build_object('workArrangement', v_arrangement::text);
  end if;

  v_source := case when p_command ? 'source' then jword.clean_text(p_command->>'source') else v_job.source end;
  if v_source is distinct from v_job.source then
    v_job_changed := true; v_changed := v_changed || '"source"'::jsonb;
    v_before := v_before || jsonb_build_object('source', v_job.source);
    v_after := v_after || jsonb_build_object('source', v_source);
  end if;

  v_description := case when p_command ? 'description' then jword.clean_text(p_command->>'description') else v_job.description end;
  if v_description is distinct from v_job.description then
    v_job_changed := true; v_changed := v_changed || '"description"'::jsonb;
  end if;

  v_date_posted := case when p_command ? 'datePosted' then jword.parse_date(p_command->>'datePosted', 'datePosted') else v_job.date_posted end;
  if v_date_posted is distinct from v_job.date_posted then
    v_job_changed := true; v_changed := v_changed || '"datePosted"'::jsonb;
    v_before := v_before || jsonb_build_object('datePosted', v_job.date_posted::text);
    v_after := v_after || jsonb_build_object('datePosted', v_date_posted::text);
  end if;

  -- Company relink: selects or creates a company for this job; never renames a shared company.
  v_company_id := v_job.company_id;
  if (p_command ? 'companyId') or (p_command ? 'company') then
    v_company_id := jword.resolve_company(v_owner, p_command->>'company', (p_command->>'companyId')::uuid);
  end if;
  if v_company_id <> v_job.company_id then
    select name into v_old_company_name from public.companies where id = v_job.company_id and user_id = v_owner;
    select name into v_company_name from public.companies where id = v_company_id and user_id = v_owner;
    v_job_changed := true; v_changed := v_changed || '"company"'::jsonb;
    v_before := v_before || jsonb_build_object('company', v_old_company_name);
    v_after := v_after || jsonb_build_object('company', v_company_name);
  end if;

  if not v_app_changed and not v_job_changed then
    v_result := jsonb_build_object(
      'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', true,
      'applicationId', v_app.id, 'version', v_app.version,
      'summary', 'No changes were needed.',
      'changedFields', '[]'::jsonb, 'before', '{}'::jsonb, 'after', '{}'::jsonb
    );
    return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
  end if;

  if v_job_changed then
    update public.jobs
    set title = v_title, normalized_title = jword.normalize_name(v_title), job_url = v_job_url,
        external_job_id = v_external_id, location = v_location, work_arrangement = v_arrangement,
        source = v_source, description = v_description, date_posted = v_date_posted,
        company_id = v_company_id
    where id = v_job.id and user_id = v_owner;
  end if;

  update public.applications
  set priority = v_priority, applied_at = v_applied_at, date_found = v_date_found,
      resume_version = v_resume, referral = v_referral,
      version = version + 1, last_activity_at = now()
  where id = v_app.id and user_id = v_owner;

  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata)
  values (
    v_owner, v_app.id, 'DETAILS_UPDATED', v_actor,
    'Updated ' || (select string_agg(value, ', ') from jsonb_array_elements_text(v_changed)),
    jsonb_build_object('fields', v_changed, 'before', v_before, 'after', v_after)
  ) returning id into v_activity_id;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'version', v_app.version + 1, 'activityId', v_activity_id,
    'summary', 'Updated ' || (select string_agg(value, ', ') from jsonb_array_elements_text(v_changed)),
    'changedFields', v_changed, 'before', v_before, 'after', v_after
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;

create or replace function public.add_application_note(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'add_application_note';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_app public.applications%rowtype;
  v_body text := p_command->>'note';
  v_note_date date := jword.parse_date(p_command->>'noteDate', 'noteDate');
  v_note_id uuid;
  v_activity_id uuid;
  v_result jsonb;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  v_app := jword.lock_application(v_owner, (p_command->>'applicationId')::uuid, (p_command->>'expectedVersion')::integer);
  if v_body is null or btrim(v_body) = '' then
    perform jword.fail('JW422', 'Note text is required.', 'NOTE_REQUIRED');
  end if;

  insert into public.application_notes (user_id, application_id, body, note_date)
  values (v_owner, v_app.id, v_body, v_note_date)
  returning id into v_note_id;

  update public.applications
  set version = version + 1, last_activity_at = now()
  where id = v_app.id and user_id = v_owner;

  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata)
  values (
    v_owner, v_app.id, 'NOTE_ADDED', v_actor,
    case when v_note_date is null then 'Added a note' else format('Added a note dated %s', v_note_date) end,
    jsonb_build_object('noteId', v_note_id, 'noteDate', v_note_date::text)
  ) returning id into v_activity_id;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'noteId', v_note_id, 'version', v_app.version + 1, 'activityId', v_activity_id,
    'summary', 'Note added',
    'changedFields', jsonb_build_array('note'), 'before', '{}'::jsonb,
    'after', jsonb_build_object('noteDate', v_note_date::text)
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;

create or replace function public.update_application_note(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'update_application_note';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_app public.applications%rowtype;
  v_note public.application_notes%rowtype;
  v_body text;
  v_note_date date;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_activity_id uuid;
  v_result jsonb;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  v_app := jword.lock_application(v_owner, (p_command->>'applicationId')::uuid, (p_command->>'expectedVersion')::integer);
  if (p_command->>'noteId') is null then
    perform jword.fail('JW422', 'A note id is required.', 'NOTE_ID_REQUIRED');
  end if;
  select * into v_note from public.application_notes
  where user_id = v_owner and id = (p_command->>'noteId')::uuid and application_id = v_app.id
  for update;
  if not found then
    perform jword.fail('JW404', 'Note not found on this application.', 'NOTE_NOT_FOUND');
  end if;
  if not (p_command ? 'note') and not (p_command ? 'noteDate') then
    perform jword.fail('JW422', 'Supply new note text and/or a note date.', 'EMPTY_UPDATE');
  end if;

  v_body := case when p_command ? 'note' then p_command->>'note' else v_note.body end;
  if v_body is null or btrim(v_body) = '' then
    perform jword.fail('JW422', 'Note text cannot be blank.', 'NOTE_REQUIRED');
  end if;
  v_note_date := case when p_command ? 'noteDate' then jword.parse_date(p_command->>'noteDate', 'noteDate') else v_note.note_date end;

  if v_body <> v_note.body then
    v_changed := v_changed || '"note"'::jsonb;
    v_before := v_before || jsonb_build_object('note', v_note.body);
    v_after := v_after || jsonb_build_object('note', v_body);
  end if;
  if v_note_date is distinct from v_note.note_date then
    v_changed := v_changed || '"noteDate"'::jsonb;
    v_before := v_before || jsonb_build_object('noteDate', v_note.note_date::text);
    v_after := v_after || jsonb_build_object('noteDate', v_note_date::text);
  end if;

  if jsonb_array_length(v_changed) = 0 then
    v_result := jsonb_build_object(
      'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', true,
      'applicationId', v_app.id, 'noteId', v_note.id, 'version', v_app.version,
      'summary', 'Note is already up to date.',
      'changedFields', '[]'::jsonb, 'before', '{}'::jsonb, 'after', '{}'::jsonb
    );
    return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
  end if;

  update public.application_notes
  set body = v_body, note_date = v_note_date
  where id = v_note.id and user_id = v_owner;

  update public.applications
  set version = version + 1, last_activity_at = now()
  where id = v_app.id and user_id = v_owner;

  -- Note text before/after stays in owner-protected history only; results expose field names.
  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata)
  values (
    v_owner, v_app.id, 'NOTE_UPDATED', v_actor,
    'Updated a note (' || (select string_agg(value, ', ') from jsonb_array_elements_text(v_changed)) || ')',
    jsonb_build_object('noteId', v_note.id, 'fields', v_changed, 'before', v_before, 'after', v_after)
  ) returning id into v_activity_id;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'noteId', v_note.id, 'version', v_app.version + 1, 'activityId', v_activity_id,
    'summary', 'Note updated',
    'changedFields', v_changed, 'before', '{}'::jsonb,
    'after', case when p_command ? 'noteDate' then jsonb_build_object('noteDate', v_note_date::text) else '{}'::jsonb end
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;

-- Import a confirmed batch all-or-nothing (decision 007). Rows never receive interactive date
-- defaults (p_today is intentionally not accepted). Each row must carry an explicit
-- duplicateChoice of 'import_separate' when it matches an existing (or earlier-imported) record.
create or replace function public.import_applications(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'import_applications';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_rows jsonb := p_command->'rows';
  v_row jsonb;
  v_row_index integer;
  v_created jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_result jsonb;
  v_row_command jsonb;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  if v_rows is null or jsonb_typeof(v_rows) <> 'array' then
    perform jword.fail('JW422', 'rows must be an array.', 'ROWS_REQUIRED');
  end if;
  if jsonb_array_length(v_rows) = 0 then
    perform jword.fail('JW422', 'No rows were selected for import.', 'ROWS_EMPTY');
  end if;
  if jsonb_array_length(v_rows) > 500 then
    perform jword.fail('JW422', 'Imports are limited to 500 rows per batch.', 'ROWS_LIMIT');
  end if;

  for v_row in select value from jsonb_array_elements(v_rows) loop
    v_row_index := coalesce((v_row->>'rowIndex')::integer, v_count + 1);
    begin
      -- Imported rows keep missing dates null: always supply explicit keys.
      v_row_command := (v_row - 'rowIndex' - 'duplicateChoice' - 'note')
        || jsonb_build_object(
          'dateFound', v_row->'dateFound',
          'appliedAt', v_row->'appliedAt',
          'initialNote', v_row->'note',
          'allowDuplicate', coalesce(v_row->>'duplicateChoice', '') = 'import_separate'
        );
      v_created := jword.create_tracked_job(
        v_owner, v_actor, v_row_command, null, 'IMPORTED', jsonb_build_object('rowIndex', v_row_index)
      );
    exception
      when sqlstate 'JW409' then
        perform jword.fail('JW42I', format('Row %s matches an existing application and has no duplicate choice.', v_row_index),
          'DUPLICATE_UNRESOLVED', jsonb_build_object('rowIndex', v_row_index));
      when sqlstate 'JW422' or sqlstate 'JW404' then
        perform jword.fail('JW42I', format('Row %s: %s', v_row_index, sqlerrm), 'ROW_INVALID',
          jsonb_build_object('rowIndex', v_row_index));
    end;
    v_ids := v_ids || (v_created->'applicationId');
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'imported', v_count, 'applicationIds', v_ids,
    'summary', format('Imported %s application(s)', v_count),
    'changedFields', '[]'::jsonb, 'before', '{}'::jsonb, 'after', '{}'::jsonb
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only signed-in users and the local service-role connector may execute wrappers.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema jword from public, anon, authenticated;

revoke execute on function public.create_application(uuid, text, uuid, jsonb, date) from public, anon;
revoke execute on function public.update_application_status(uuid, text, uuid, jsonb, date) from public, anon;
revoke execute on function public.update_application_details(uuid, text, uuid, jsonb, date) from public, anon;
revoke execute on function public.add_application_note(uuid, text, uuid, jsonb, date) from public, anon;
revoke execute on function public.update_application_note(uuid, text, uuid, jsonb, date) from public, anon;
revoke execute on function public.import_applications(uuid, text, uuid, jsonb) from public, anon;

grant execute on function public.create_application(uuid, text, uuid, jsonb, date) to authenticated, service_role;
grant execute on function public.update_application_status(uuid, text, uuid, jsonb, date) to authenticated, service_role;
grant execute on function public.update_application_details(uuid, text, uuid, jsonb, date) to authenticated, service_role;
grant execute on function public.add_application_note(uuid, text, uuid, jsonb, date) to authenticated, service_role;
grant execute on function public.update_application_note(uuid, text, uuid, jsonb, date) to authenticated, service_role;
grant execute on function public.import_applications(uuid, text, uuid, jsonb) to authenticated, service_role;
