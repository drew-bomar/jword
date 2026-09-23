-- Company watchlist (decision 018, JWO-16).
--
-- Records which companies' public job boards jword should monitor in a later ticket. This is
-- configuration only: nothing here fetches, stores, or schedules job postings.
--
-- Same write contract as the tracker (decisions 002, 008, 009, 010): authenticated clients can
-- read their rows but cannot write tables directly. Each public wrapper resolves the owner,
-- validates the raw command, and delegates to a private implementation that commits the watch
-- row, the company fields it edits, one audit row, the version bump, and the retry receipt in a
-- single transaction.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.ats_provider as enum ('GREENHOUSE', 'LEVER', 'ASHBY', 'OTHER');
create type public.watch_event_type as enum (
  'WATCH_CREATED', 'WATCH_UPDATED', 'WATCH_ACTIVATED', 'WATCH_DEACTIVATED'
);

-- ---------------------------------------------------------------------------
-- company_watches: one watch per company per owner.
-- ---------------------------------------------------------------------------
create table public.company_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  active boolean not null default true,
  provider public.ats_provider not null,
  -- Greenhouse board token, Lever site slug, or Ashby job-board name. Null for OTHER.
  board_identifier text,
  -- Canonical public board URL for supported providers; optional careers page for OTHER.
  board_url text,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_watches_user_company_key unique (user_id, company_id),
  constraint company_watches_user_id_id_key unique (user_id, id),
  -- Composite FK: a watch can only reference a company owned by the same user.
  constraint company_watches_company_owner_fkey foreign key (user_id, company_id)
    references public.companies (user_id, id) on delete restrict,
  -- Mirrors BOARD_IDENTIFIER_PATTERN and canonicalBoardUrl() in packages/core/src/watchlist/boards.ts.
  constraint company_watches_board_shape check (
    (provider = 'OTHER' and board_identifier is null)
    or (
      provider <> 'OTHER'
      and board_identifier is not null
      and board_url is not null
      and board_identifier ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
      and board_url = case provider
        when 'GREENHOUSE' then 'https://job-boards.greenhouse.io/' || board_identifier
        when 'LEVER' then 'https://jobs.lever.co/' || board_identifier
        when 'ASHBY' then 'https://jobs.ashbyhq.com/' || board_identifier
      end
    )
  ),
  constraint company_watches_board_url_http check (
    board_url is null or (board_url ~* '^https?://[^[:space:]]+$' and length(board_url) <= 2048)
  )
);
-- The same board must not be watched twice under two company names (it would double-collect).
create unique index company_watches_user_board_key
  on public.company_watches (user_id, provider, lower(board_identifier))
  where board_identifier is not null;
create index company_watches_user_active_idx on public.company_watches (user_id, active);
create trigger company_watches_set_updated_at
  before update on public.company_watches
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- company_watch_activities: append-only audit trail for watch mutations.
-- ---------------------------------------------------------------------------
create table public.company_watch_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  watch_id uuid not null,
  type public.watch_event_type not null,
  actor_type public.actor_type not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint company_watch_activities_watch_owner_fkey foreign key (user_id, watch_id)
    references public.company_watches (user_id, id) on delete cascade
);
create index company_watch_activities_watch_idx
  on public.company_watch_activities (user_id, watch_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Read model for the watchlist page and MCP reads. security_invoker keeps the caller's RLS.
-- ---------------------------------------------------------------------------
create view public.company_watch_overview
with (security_invoker = true) as
select
  w.id as watch_id,
  w.user_id,
  w.company_id,
  c.name as company_name,
  c.normalized_name as company_normalized_name,
  c.website_url,
  c.interest_level,
  c.notes as company_notes,
  w.provider,
  w.board_identifier,
  w.board_url,
  w.active,
  w.version,
  w.created_at,
  w.updated_at,
  (
    select count(*)::integer
    from public.jobs j
    join public.applications a on a.job_id = j.id and a.user_id = j.user_id
    where j.user_id = w.user_id and j.company_id = w.company_id
  ) as application_count,
  last_event.type as last_event_type,
  last_event.actor_type as last_event_actor_type,
  last_event.summary as last_event_summary,
  last_event.occurred_at as last_event_at
from public.company_watches w
join public.companies c on c.id = w.company_id and c.user_id = w.user_id
left join lateral (
  select x.type, x.actor_type, x.summary, x.occurred_at
  from public.company_watch_activities x
  where x.user_id = w.user_id and x.watch_id = w.id
  order by x.occurred_at desc, x.created_at desc
  limit 1
) last_event on true;

-- ---------------------------------------------------------------------------
-- Row Level Security and grants: owners read; nobody writes directly (decision 010).
-- ---------------------------------------------------------------------------
alter table public.company_watches enable row level security;
alter table public.company_watch_activities enable row level security;

create policy company_watches_owner_select on public.company_watches
  for select to authenticated using ((select auth.uid()) = user_id);
create policy company_watch_activities_owner_select on public.company_watch_activities
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.company_watches, public.company_watch_activities, public.company_watch_overview
  from anon, authenticated;
grant select on public.company_watches, public.company_watch_activities, public.company_watch_overview
  to authenticated;
grant select, insert, update, delete on public.company_watches, public.company_watch_activities
  to service_role;
grant select on public.company_watch_overview to service_role;

-- ---------------------------------------------------------------------------
-- Direct-RPC validation. Same rules as jword.validate_command (migration 005), applied to a
-- spec passed in, plus an optional `pattern` for text fields.
-- ---------------------------------------------------------------------------
create or replace function jword.validate_object(p_spec jsonb, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_rule jsonb; v_key text; v_value jsonb; v_text text;
  v_result jsonb := '{}'::jsonb;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    perform jword.fail('JW422', 'Command must be an object.', 'INVALID_COMMAND');
  end if;
  for v_key in select jsonb_object_keys(p_command) loop
    if not (p_spec ? v_key) then perform jword.fail('JW422', 'Unknown command field.', 'FIELD_NOT_ALLOWED'); end if;
  end loop;
  for v_key, v_rule in select key, value from jsonb_each(p_spec) loop
    if not (p_command ? v_key) then
      if coalesce((v_rule->>'required')::boolean, false) then
        perform jword.fail('JW422', format('%s is required.', v_key), 'REQUIRED_FIELD');
      end if;
      continue;
    end if;
    v_value := p_command->v_key;
    if jsonb_typeof(v_value) = 'string' then
      v_text := regexp_replace(p_command->>v_key, '^\s+|\s+$', '', 'g');
      if v_rule->>'type' in ('text', 'url') then v_value := to_jsonb(v_text); end if;
      if v_text = '' and coalesce((v_rule->>'nullable')::boolean, false) and v_rule->>'type' in ('text', 'url') then
        v_value := 'null'::jsonb;
      end if;
    end if;
    if v_value = 'null'::jsonb then
      if not coalesce((v_rule->>'nullable')::boolean, false) then
        perform jword.fail('JW422', format('%s cannot be null.', v_key), 'INVALID_FIELD');
      end if;
    elsif v_rule->>'type' = 'boolean' then
      if jsonb_typeof(v_value) <> 'boolean' then perform jword.fail('JW422', format('%s must be a boolean.', v_key), 'INVALID_FIELD'); end if;
    elsif v_rule->>'type' = 'integer' then
      if jsonb_typeof(v_value) <> 'number' then perform jword.fail('JW422', format('%s must be an integer.', v_key), 'INVALID_FIELD'); end if;
      if (v_value::text)::numeric <> trunc((v_value::text)::numeric)
        or (v_value::text)::numeric not between (v_rule->>'min')::numeric and (v_rule->>'max')::numeric then
        perform jword.fail('JW422', format('%s is outside its allowed integer range.', v_key), 'INVALID_FIELD');
      end if;
    else
      if jsonb_typeof(v_value) <> 'string' then perform jword.fail('JW422', format('%s must be text.', v_key), 'INVALID_FIELD'); end if;
      v_text := v_value #>> '{}';
      if v_rule ? 'max' and length(v_text) > (v_rule->>'max')::integer then
        perform jword.fail('JW422', format('%s is too long.', v_key), 'INVALID_FIELD');
      end if;
      case v_rule->>'type'
        when 'text' then
          if v_text = '' then perform jword.fail('JW422', format('%s cannot be blank.', v_key), 'INVALID_FIELD'); end if;
          if v_rule ? 'pattern' and v_text !~ (v_rule->>'pattern') then
            perform jword.fail('JW422', format('%s has an invalid format.', v_key), 'INVALID_FIELD');
          end if;
        when 'url' then
          if v_text !~* '^https?://[^[:space:]]+$' then perform jword.fail('JW422', format('%s must be an HTTP or HTTPS URL.', v_key), 'INVALID_FIELD'); end if;
        when 'uuid' then
          if v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
            perform jword.fail('JW422', format('%s must be a UUID.', v_key), 'INVALID_FIELD');
          end if;
        when 'enum' then
          if not (v_rule->'values' ? v_text) then perform jword.fail('JW422', format('%s has an unknown value.', v_key), 'INVALID_FIELD'); end if;
      end case;
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;
  return v_result;
end;
$$;

create or replace function jword.validate_watch_command(p_operation text, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_board constant jsonb := $b${
    "provider": {"type": "enum", "values": ["GREENHOUSE", "LEVER", "ASHBY", "OTHER"]},
    "boardIdentifier": {"type": "text", "max": 100, "nullable": true, "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"},
    "boardUrl": {"type": "url", "max": 2048, "nullable": true},
    "interestLevel": {"type": "integer", "min": 1, "max": 5, "nullable": true},
    "websiteUrl": {"type": "url", "max": 2048, "nullable": true},
    "companyNotes": {"type": "text", "max": 5000, "nullable": true}
  }$b$::jsonb;
  v_existing constant jsonb := $e${
    "watchId": {"type": "uuid", "required": true},
    "expectedVersion": {"type": "integer", "required": true, "min": 1, "max": 2147483647}
  }$e$::jsonb;
  v_result jsonb;
begin
  case p_operation
    when 'create_company_watch' then
      v_result := jword.validate_object(
        v_board
          || jsonb_build_object('provider', (v_board->'provider') || '{"required": true}'::jsonb)
          || '{"company": {"type": "text", "max": 200}, "companyId": {"type": "uuid"}}'::jsonb,
        p_command
      );
      if not (v_result ? 'company' or v_result ? 'companyId') then
        perform jword.fail('JW422', 'Company is required.', 'COMPANY_REQUIRED');
      end if;
    when 'update_company_watch' then
      v_result := jword.validate_object(v_board || v_existing, p_command);
      if v_result - 'watchId' - 'expectedVersion' = '{}'::jsonb then
        perform jword.fail('JW422', 'Supply at least one editable field.', 'EMPTY_UPDATE');
      end if;
    when 'set_company_watch_active' then
      v_result := jword.validate_object(
        v_existing || '{"active": {"type": "boolean", "required": true}}'::jsonb,
        p_command
      );
    else
      perform jword.fail('JW422', 'Unknown operation.', 'INVALID_OPERATION');
  end case;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function jword.provider_label(p_provider public.ats_provider)
returns text language sql immutable set search_path = '' as $$
  select case p_provider
    when 'GREENHOUSE' then 'Greenhouse'
    when 'LEVER' then 'Lever'
    when 'ASHBY' then 'Ashby'
    else 'no supported job board'
  end;
$$;

-- Final board configuration rules (decision 018). Returns the board URL to store:
-- derived for supported providers, the optional careers URL for OTHER.
create or replace function jword.resolve_board_url(
  p_provider public.ats_provider, p_identifier text, p_other_url text
)
returns text language plpgsql set search_path = '' as $$
begin
  if p_provider = 'OTHER' then
    if p_identifier is not null then
      perform jword.fail('JW422', 'A board identifier applies only to Greenhouse, Lever, or Ashby.', 'BOARD_IDENTIFIER_NOT_ALLOWED');
    end if;
    return p_other_url;
  end if;
  if p_identifier is null then
    perform jword.fail('JW422', format('%s needs a board identifier.', jword.provider_label(p_provider)), 'BOARD_IDENTIFIER_REQUIRED');
  end if;
  if p_identifier !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' then
    perform jword.fail('JW422', 'Board identifier has an invalid format.', 'BOARD_IDENTIFIER_INVALID');
  end if;
  if p_other_url is not null then
    perform jword.fail('JW422', 'The board URL is set from the provider and identifier.', 'BOARD_URL_DERIVED');
  end if;
  return case p_provider
    when 'GREENHOUSE' then 'https://job-boards.greenhouse.io/' || p_identifier
    when 'LEVER' then 'https://jobs.lever.co/' || p_identifier
    when 'ASHBY' then 'https://jobs.ashbyhq.com/' || p_identifier
  end;
end;
$$;

-- One board per owner: report which company already watches it.
create or replace function jword.assert_board_free(
  p_owner_id uuid, p_provider public.ats_provider, p_identifier text, p_exclude_watch uuid
)
returns void language plpgsql set search_path = '' as $$
declare
  v_watch_id uuid;
  v_company text;
begin
  if p_identifier is null then
    return;
  end if;
  select w.id, c.name into v_watch_id, v_company
  from public.company_watches w
  join public.companies c on c.id = w.company_id and c.user_id = w.user_id
  where w.user_id = p_owner_id
    and w.provider = p_provider
    and lower(w.board_identifier) = lower(p_identifier)
    and w.id is distinct from p_exclude_watch;
  if v_watch_id is not null then
    perform jword.fail(
      'JW409',
      format('This %s board is already watched for %s.', jword.provider_label(p_provider), v_company),
      'BOARD_ALREADY_WATCHED',
      jsonb_build_object('watchId', v_watch_id, 'company', v_company)
    );
  end if;
end;
$$;

-- Lock the watch row, verify ownership, and enforce the expected version (decision 008).
create or replace function jword.lock_watch(p_owner_id uuid, p_watch_id uuid, p_expected_version integer)
returns public.company_watches language plpgsql set search_path = '' as $$
declare
  v_watch public.company_watches%rowtype;
begin
  select * into v_watch from public.company_watches
  where user_id = p_owner_id and id = p_watch_id
  for update;
  if not found then
    perform jword.fail('JW404', 'Watched company not found.', 'WATCH_NOT_FOUND');
  end if;
  if v_watch.version <> p_expected_version then
    perform jword.fail(
      'JW409',
      'This watch changed since you opened it. Refresh before saving.',
      'STALE_VERSION',
      jsonb_build_object('currentVersion', v_watch.version, 'expectedVersion', p_expected_version)
    );
  end if;
  return v_watch;
end;
$$;

-- Apply the reused company fields (interest level, website, notes) when present in the command.
-- Returns {changed: [...], before: {...}, after: {...}}; note text is never copied out.
create or replace function jword.apply_company_fields(p_owner_id uuid, p_company public.companies, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_interest smallint := p_company.interest_level;
  v_website text := p_company.website_url;
  v_notes text := p_company.notes;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if p_command ? 'interestLevel' then
    v_interest := (p_command->>'interestLevel')::smallint;
    if v_interest is distinct from p_company.interest_level then
      v_changed := v_changed || '"interestLevel"'::jsonb;
      v_before := v_before || jsonb_build_object('interestLevel', p_company.interest_level);
      v_after := v_after || jsonb_build_object('interestLevel', v_interest);
    end if;
  end if;
  if p_command ? 'websiteUrl' then
    v_website := jword.clean_text(p_command->>'websiteUrl');
    if v_website is distinct from p_company.website_url then
      v_changed := v_changed || '"websiteUrl"'::jsonb;
      v_before := v_before || jsonb_build_object('websiteUrl', p_company.website_url);
      v_after := v_after || jsonb_build_object('websiteUrl', v_website);
    end if;
  end if;
  if p_command ? 'companyNotes' then
    v_notes := jword.clean_text(p_command->>'companyNotes');
    if v_notes is distinct from p_company.notes then
      v_changed := v_changed || '"companyNotes"'::jsonb;
    end if;
  end if;
  if jsonb_array_length(v_changed) > 0 then
    update public.companies
    set interest_level = v_interest, website_url = v_website, notes = v_notes
    where user_id = p_owner_id and id = p_company.id;
  end if;
  return jsonb_build_object('changed', v_changed, 'before', v_before, 'after', v_after);
end;
$$;

create or replace function jword.add_watch_activity(
  p_owner_id uuid, p_watch_id uuid, p_type public.watch_event_type, p_actor public.actor_type,
  p_summary text, p_metadata jsonb
)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.company_watch_activities (user_id, watch_id, type, actor_type, summary, metadata)
  values (p_owner_id, p_watch_id, p_type, p_actor, p_summary, p_metadata)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Private implementations
-- ---------------------------------------------------------------------------
create or replace function jword.create_company_watch(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'create_company_watch';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_replay jsonb;
  v_company public.companies%rowtype;
  v_company_created boolean := false;
  v_name text;
  v_existing public.company_watches%rowtype;
  v_provider public.ats_provider := (p_command->>'provider')::public.ats_provider;
  v_identifier text := jword.clean_text(p_command->>'boardIdentifier');
  v_url text;
  v_watch public.company_watches%rowtype;
  v_company_changes jsonb;
  v_changed jsonb;
  v_after jsonb;
  v_summary text;
  v_activity_id uuid;
begin
  v_replay := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_replay is not null then
    return v_replay;
  end if;

  -- Company: explicit id (must belong to the owner) or decision-013 exact match-or-create.
  if p_command ? 'companyId' then
    select * into v_company from public.companies
    where user_id = p_owner_id and id = (p_command->>'companyId')::uuid
    for update;
    if not found then
      perform jword.fail('JW404', 'Selected company was not found.', 'COMPANY_NOT_FOUND');
    end if;
  else
    v_name := jword.clean_text(p_command->>'company');
    if v_name is null then
      perform jword.fail('JW422', 'Company name is required.', 'COMPANY_REQUIRED');
    end if;
    insert into public.companies (user_id, name, normalized_name)
    values (p_owner_id, v_name, jword.normalize_name(v_name))
    on conflict (user_id, normalized_name) do nothing
    returning * into v_company;
    if v_company.id is not null then
      v_company_created := true;
    else
      select * into v_company from public.companies
      where user_id = p_owner_id and normalized_name = jword.normalize_name(v_name)
      for update;
    end if;
  end if;

  -- One watch per company, active or not. The caller can reactivate the existing one.
  select * into v_existing from public.company_watches
  where user_id = p_owner_id and company_id = v_company.id
  for update;
  if found then
    perform jword.fail(
      'JW409',
      format('%s is already on your watchlist%s.', v_company.name, case when v_existing.active then '' else ' (inactive)' end),
      'ALREADY_WATCHED',
      jsonb_build_object('watchId', v_existing.id, 'watchActive', v_existing.active, 'currentVersion', v_existing.version)
    );
  end if;

  v_url := jword.resolve_board_url(v_provider, v_identifier, jword.clean_text(p_command->>'boardUrl'));
  perform jword.assert_board_free(p_owner_id, v_provider, v_identifier, null);

  begin
    insert into public.company_watches (user_id, company_id, provider, board_identifier, board_url)
    values (p_owner_id, v_company.id, v_provider, v_identifier, v_url)
    returning * into v_watch;
  exception when unique_violation then
    -- A concurrent save won the race; report it the same way as the checks above.
    select * into v_existing from public.company_watches
    where user_id = p_owner_id and company_id = v_company.id;
    if found then
      perform jword.fail('JW409', format('%s is already on your watchlist.', v_company.name), 'ALREADY_WATCHED',
        jsonb_build_object('watchId', v_existing.id, 'watchActive', v_existing.active, 'currentVersion', v_existing.version));
    end if;
    perform jword.assert_board_free(p_owner_id, v_provider, v_identifier, null);
    raise;
  end;

  v_company_changes := jword.apply_company_fields(p_owner_id, v_company, p_command);
  v_changed := '["provider", "boardIdentifier", "boardUrl", "active"]'::jsonb || (v_company_changes->'changed');
  v_after := jsonb_build_object(
    'provider', v_provider, 'boardIdentifier', v_identifier, 'boardUrl', v_url, 'active', true
  ) || (v_company_changes->'after');
  v_summary := format('Started watching %s (%s)', v_company.name, jword.provider_label(v_provider));
  v_activity_id := jword.add_watch_activity(
    p_owner_id, v_watch.id, 'WATCH_CREATED', v_actor, v_summary,
    jsonb_build_object(
      'companyId', v_company.id, 'companyCreated', v_company_created, 'fields', v_changed,
      'before', v_company_changes->'before', 'after', v_after
    )
  );

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'watchId', v_watch.id, 'companyId', v_company.id, 'company', v_company.name,
    'companyCreated', v_company_created, 'active', true, 'version', 1,
    'activityId', v_activity_id, 'summary', v_summary, 'changedFields', v_changed,
    'before', v_company_changes->'before', 'after', v_after
  ));
end;
$$;

create or replace function jword.update_company_watch(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'update_company_watch';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_replay jsonb;
  v_watch public.company_watches%rowtype;
  v_company public.companies%rowtype;
  v_provider public.ats_provider;
  v_identifier text;
  v_other_url text;
  v_url text;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_company_changes jsonb;
  v_version integer;
  v_summary text;
  v_activity_id uuid;
begin
  v_replay := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_replay is not null then
    return v_replay;
  end if;

  v_watch := jword.lock_watch(p_owner_id, (p_command->>'watchId')::uuid, (p_command->>'expectedVersion')::integer);
  select * into v_company from public.companies
  where user_id = p_owner_id and id = v_watch.company_id
  for update;

  -- Board configuration: validate the final state, not only the supplied fields.
  v_provider := coalesce((p_command->>'provider')::public.ats_provider, v_watch.provider);
  v_identifier := case when p_command ? 'boardIdentifier'
    then jword.clean_text(p_command->>'boardIdentifier') else v_watch.board_identifier end;
  v_other_url := case
    when p_command ? 'boardUrl' then jword.clean_text(p_command->>'boardUrl')
    when v_provider = 'OTHER' and v_watch.provider = 'OTHER' then v_watch.board_url
    else null
  end;
  v_url := jword.resolve_board_url(v_provider, v_identifier, v_other_url);

  if v_provider <> v_watch.provider then
    v_changed := v_changed || '"provider"'::jsonb;
    v_before := v_before || jsonb_build_object('provider', v_watch.provider);
    v_after := v_after || jsonb_build_object('provider', v_provider);
  end if;
  if v_identifier is distinct from v_watch.board_identifier then
    v_changed := v_changed || '"boardIdentifier"'::jsonb;
    v_before := v_before || jsonb_build_object('boardIdentifier', v_watch.board_identifier);
    v_after := v_after || jsonb_build_object('boardIdentifier', v_identifier);
  end if;
  if v_url is distinct from v_watch.board_url then
    v_changed := v_changed || '"boardUrl"'::jsonb;
    v_before := v_before || jsonb_build_object('boardUrl', v_watch.board_url);
    v_after := v_after || jsonb_build_object('boardUrl', v_url);
  end if;
  if v_changed ? 'provider' or v_changed ? 'boardIdentifier' then
    perform jword.assert_board_free(p_owner_id, v_provider, v_identifier, v_watch.id);
  end if;

  v_company_changes := jword.apply_company_fields(p_owner_id, v_company, p_command);
  v_changed := v_changed || (v_company_changes->'changed');
  v_before := v_before || (v_company_changes->'before');
  v_after := v_after || (v_company_changes->'after');

  if jsonb_array_length(v_changed) = 0 then
    return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
      'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', true,
      'watchId', v_watch.id, 'companyId', v_company.id, 'company', v_company.name,
      'active', v_watch.active, 'version', v_watch.version, 'activityId', null,
      'summary', 'No changes to save.', 'changedFields', '[]'::jsonb,
      'before', '{}'::jsonb, 'after', '{}'::jsonb
    ));
  end if;

  update public.company_watches
  set provider = v_provider, board_identifier = v_identifier, board_url = v_url, version = version + 1
  where user_id = p_owner_id and id = v_watch.id
  returning version into v_version;

  v_summary := format('Updated watch for %s', v_company.name);
  v_activity_id := jword.add_watch_activity(
    p_owner_id, v_watch.id, 'WATCH_UPDATED', v_actor, v_summary,
    jsonb_build_object('fields', v_changed, 'before', v_before, 'after', v_after)
  );

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'watchId', v_watch.id, 'companyId', v_company.id, 'company', v_company.name,
    'active', v_watch.active, 'version', v_version, 'activityId', v_activity_id,
    'summary', v_summary, 'changedFields', v_changed, 'before', v_before, 'after', v_after
  ));
end;
$$;

create or replace function jword.set_company_watch_active(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'set_company_watch_active';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_replay jsonb;
  v_watch public.company_watches%rowtype;
  v_company_name text;
  v_active boolean := (p_command->>'active')::boolean;
  v_version integer;
  v_summary text;
  v_activity_id uuid;
begin
  v_replay := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_replay is not null then
    return v_replay;
  end if;

  v_watch := jword.lock_watch(p_owner_id, (p_command->>'watchId')::uuid, (p_command->>'expectedVersion')::integer);
  select name into v_company_name from public.companies
  where user_id = p_owner_id and id = v_watch.company_id;

  if v_watch.active = v_active then
    return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
      'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', true,
      'watchId', v_watch.id, 'companyId', v_watch.company_id, 'company', v_company_name,
      'active', v_active, 'version', v_watch.version, 'activityId', null,
      'summary', format('%s is already %s.', v_company_name, case when v_active then 'active' else 'inactive' end),
      'changedFields', '[]'::jsonb, 'before', '{}'::jsonb, 'after', '{}'::jsonb
    ));
  end if;

  -- Only the flag changes. The company, its applications, and history are untouched.
  update public.company_watches
  set active = v_active, version = version + 1
  where user_id = p_owner_id and id = v_watch.id
  returning version into v_version;

  v_summary := format('%s watching %s', case when v_active then 'Resumed' else 'Stopped' end, v_company_name);
  v_activity_id := jword.add_watch_activity(
    p_owner_id, v_watch.id,
    case when v_active then 'WATCH_ACTIVATED' else 'WATCH_DEACTIVATED' end::public.watch_event_type,
    v_actor, v_summary,
    jsonb_build_object('fields', '["active"]'::jsonb,
      'before', jsonb_build_object('active', v_watch.active), 'after', jsonb_build_object('active', v_active))
  );

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'watchId', v_watch.id, 'companyId', v_watch.company_id, 'company', v_company_name,
    'active', v_active, 'version', v_version, 'activityId', v_activity_id, 'summary', v_summary,
    'changedFields', '["active"]'::jsonb,
    'before', jsonb_build_object('active', v_watch.active), 'after', jsonb_build_object('active', v_active)
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Public wrappers: resolve owner, validate the raw command, delegate.
-- ---------------------------------------------------------------------------
create function public.create_company_watch(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_watch_command('create_company_watch', p_command);
begin
  return jword.create_company_watch(v_owner, p_actor, p_request_id, v_command);
end;
$$;

create function public.update_company_watch(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_watch_command('update_company_watch', p_command);
begin
  return jword.update_company_watch(v_owner, p_actor, p_request_id, v_command);
end;
$$;

create function public.set_company_watch_active(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_watch_command('set_company_watch_active', p_command);
begin
  return jword.set_company_watch_active(v_owner, p_actor, p_request_id, v_command);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function jword.validate_object(jsonb, jsonb) from public, anon, authenticated;
revoke all on function jword.validate_watch_command(text, jsonb) from public, anon, authenticated;
revoke all on function jword.provider_label(public.ats_provider) from public, anon, authenticated;
revoke all on function jword.resolve_board_url(public.ats_provider, text, text) from public, anon, authenticated;
revoke all on function jword.assert_board_free(uuid, public.ats_provider, text, uuid) from public, anon, authenticated;
revoke all on function jword.lock_watch(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function jword.apply_company_fields(uuid, public.companies, jsonb) from public, anon, authenticated;
revoke all on function jword.add_watch_activity(uuid, uuid, public.watch_event_type, public.actor_type, text, jsonb) from public, anon, authenticated;
revoke all on function jword.create_company_watch(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function jword.update_company_watch(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function jword.set_company_watch_active(uuid, text, uuid, jsonb) from public, anon, authenticated;

revoke all on function public.create_company_watch(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.update_company_watch(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.set_company_watch_active(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.create_company_watch(uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_company_watch(uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_company_watch_active(uuid, text, uuid, jsonb) to authenticated, service_role;
