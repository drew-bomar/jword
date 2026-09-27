-- Review corrections for decisions 024 and 025. Additive because the first two migrations
-- are already applied locally. No existing lead or application data is rewritten.

create unique index lead_scans_one_running_per_source
  on public.lead_scans (user_id, source_id) where status = 'RUNNING';

create or replace function jword.lock_running_scan(p_owner_id uuid, p_scan_id uuid)
returns public.lead_scans language plpgsql set search_path = '' as $$
declare
  v_scan public.lead_scans%rowtype;
begin
  -- begin_lead_scan holds the source before recovering stale scans. Use that same
  -- order in record/finish, including when a worker resumes after five minutes.
  perform 1 from public.lead_sources s
  where s.user_id = p_owner_id and s.id = (
    select source_id from public.lead_scans where user_id = p_owner_id and id = p_scan_id
  ) for update;

  select * into v_scan from public.lead_scans
  where user_id = p_owner_id and id = p_scan_id
  for update;
  if not found then
    perform jword.fail('JW404', 'Scan not found.', 'SCAN_NOT_FOUND');
  end if;
  if v_scan.status <> 'RUNNING' then
    perform jword.fail('JW409', 'This scan has already finished.', 'SCAN_FINISHED');
  end if;
  return v_scan;
end;
$$;

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
  -- The duplicate probe and insert must share a transaction lock across every entry point
  -- (manual creation, imports, and leads). Different request IDs alone do not serialize them.
  perform pg_advisory_xact_lock(hashtextextended('jword:create_application:' || p_owner_id::text, 0));

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
