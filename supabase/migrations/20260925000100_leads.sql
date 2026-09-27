-- Decision 024: job collection and the Leads inbox.
--
-- A lead is a posting collected from a watched board. Leads hang off `lead_sources`, a durable
-- record of a board's identity (provider + case-insensitive identifier) that has no foreign key
-- to watch configuration, so deleting a watch or board keeps its leads, and re-adding the same
-- board reuses the source instead of duplicating postings.
--
-- Availability (is the posting still listed?) and review status (what the owner decided) are
-- separate. Only a COMPLETE scan may mark unseen postings unavailable; collection never touches
-- review status. Same write contract as the rest of jword (decision 010): authenticated clients
-- read their rows through RLS and write only through these functions.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.lead_review_status as enum ('NEW', 'DISMISSED', 'PROMOTED');
create type public.lead_availability as enum ('AVAILABLE', 'UNAVAILABLE');
create type public.lead_scan_status as enum ('RUNNING', 'COMPLETE', 'PARTIAL', 'FAILED');
create type public.lead_event_type as enum ('LEAD_DISMISSED', 'LEAD_RESTORED', 'LEAD_PROMOTED');

-- ---------------------------------------------------------------------------
-- lead_sources: one row per board ever collected, independent of watch configuration.
-- ---------------------------------------------------------------------------
create table public.lead_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The company the board was last collected for.
  company_id uuid not null,
  provider public.ats_provider not null,
  board_identifier text not null,
  board_key text generated always as (lower(board_identifier)) stored,
  board_url text not null,
  last_scan_status public.lead_scan_status,
  last_scanned_at timestamptz,
  last_complete_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_sources_user_id_id_key unique (user_id, id),
  constraint lead_sources_user_board_key unique (user_id, provider, board_key),
  constraint lead_sources_company_owner_fkey foreign key (user_id, company_id)
    references public.companies (user_id, id) on delete restrict,
  constraint lead_sources_supported_board check (
    provider <> 'OTHER'
    and jword.canonical_board_url(provider, board_identifier) is not null
    and board_url = jword.canonical_board_url(provider, board_identifier)
  )
);
create trigger lead_sources_set_updated_at
  before update on public.lead_sources
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_scans: one row per board check, the audit record of collection.
-- ---------------------------------------------------------------------------
create table public.lead_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null,
  -- Historical: the watch that requested the scan. No foreign key; watches can be deleted.
  watch_id uuid not null,
  company_id uuid not null,
  actor_type public.actor_type not null,
  status public.lead_scan_status not null default 'RUNNING',
  reason text check (reason ~ '^[A-Z_]{1,40}$'),
  reported_total integer check (reported_total >= 0),
  postings_seen integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  relisted_count integer not null default 0,
  unavailable_count integer not null default 0,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  constraint lead_scans_user_id_id_key unique (user_id, id),
  constraint lead_scans_source_owner_fkey foreign key (user_id, source_id)
    references public.lead_sources (user_id, id) on delete restrict,
  constraint lead_scans_finished check ((status = 'RUNNING') = (finished_at is null))
);
create index lead_scans_source_idx on public.lead_scans (user_id, source_id, started_at desc);

-- ---------------------------------------------------------------------------
-- leads: collected postings. Never deleted by watch or board changes.
-- ---------------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null,
  company_id uuid not null,
  provider_posting_id text not null check (length(provider_posting_id) between 1 and 500),
  title text not null check (btrim(title) <> '' and length(title) <= 500),
  location text check (length(location) <= 500),
  job_url text not null check (job_url ~* '^https?://[^[:space:]]+$' and length(job_url) <= 2048),
  description text check (length(description) <= 10000),
  -- Only a date the provider stated; never inferred.
  posted_on date,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  last_scan_id uuid not null,
  availability public.lead_availability not null default 'AVAILABLE',
  unavailable_at timestamptz,
  review_status public.lead_review_status not null default 'NEW',
  reviewed_at timestamptz,
  application_id uuid,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_user_id_id_key unique (user_id, id),
  -- A posting is collected once per owner and board, whatever watch or scan found it.
  constraint leads_source_posting_key unique (user_id, source_id, provider_posting_id),
  constraint leads_source_owner_fkey foreign key (user_id, source_id)
    references public.lead_sources (user_id, id) on delete restrict,
  constraint leads_company_owner_fkey foreign key (user_id, company_id)
    references public.companies (user_id, id) on delete restrict,
  constraint leads_application_owner_fkey foreign key (user_id, application_id)
    references public.applications (user_id, id) on delete restrict,
  constraint leads_promoted_has_application check ((review_status = 'PROMOTED') = (application_id is not null)),
  constraint leads_unavailable_since check ((availability = 'UNAVAILABLE') = (unavailable_at is not null))
);
create index leads_user_found_idx on public.leads (user_id, first_seen_at desc, id);
create index leads_user_company_idx on public.leads (user_id, company_id);
create index leads_source_availability_idx on public.leads (user_id, source_id, availability, last_seen_at);
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- lead_activities: audit of the owner's decisions about a lead.
-- ---------------------------------------------------------------------------
create table public.lead_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lead_id uuid not null,
  type public.lead_event_type not null,
  actor_type public.actor_type not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint lead_activities_lead_owner_fkey foreign key (user_id, lead_id)
    references public.leads (user_id, id) on delete restrict
);
create index lead_activities_lead_idx on public.lead_activities (user_id, lead_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Read model for the Leads page. security_invoker keeps the caller's RLS. No description.
-- ---------------------------------------------------------------------------
create view public.lead_overview
with (security_invoker = true) as
select
  l.id as lead_id,
  l.user_id,
  l.company_id,
  c.name as company_name,
  l.source_id,
  s.provider,
  s.board_identifier,
  l.provider_posting_id,
  l.title,
  l.location,
  l.job_url,
  l.posted_on,
  l.first_seen_at,
  l.last_seen_at,
  l.availability,
  l.unavailable_at,
  l.review_status,
  l.application_id,
  l.version
from public.leads l
join public.companies c on c.id = l.company_id and c.user_id = l.user_id
join public.lead_sources s on s.id = l.source_id and s.user_id = l.user_id;

alter table public.lead_sources enable row level security;
alter table public.lead_scans enable row level security;
alter table public.leads enable row level security;
alter table public.lead_activities enable row level security;

create policy lead_sources_owner_select on public.lead_sources
  for select to authenticated using ((select auth.uid()) = user_id);
create policy lead_scans_owner_select on public.lead_scans
  for select to authenticated using ((select auth.uid()) = user_id);
create policy leads_owner_select on public.leads
  for select to authenticated using ((select auth.uid()) = user_id);
create policy lead_activities_owner_select on public.lead_activities
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.lead_sources, public.lead_scans, public.leads, public.lead_activities,
  public.lead_overview from anon, authenticated;
grant select on public.lead_sources, public.lead_scans, public.leads, public.lead_activities,
  public.lead_overview to authenticated;
grant select, insert, update, delete on public.lead_sources, public.lead_scans, public.leads,
  public.lead_activities to service_role;
grant select on public.lead_overview to service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create function jword.lock_lead(p_owner_id uuid, p_lead_id uuid, p_expected_version integer)
returns public.leads language plpgsql set search_path = '' as $$
declare
  v_lead public.leads%rowtype;
begin
  select * into v_lead from public.leads
  where user_id = p_owner_id and id = p_lead_id
  for update;
  if not found then
    perform jword.fail('JW404', 'Lead not found.', 'LEAD_NOT_FOUND');
  end if;
  if v_lead.version <> p_expected_version then
    perform jword.fail(
      'JW409',
      'This lead changed since you opened it. Refresh before saving.',
      'STALE_VERSION',
      jsonb_build_object('currentVersion', v_lead.version, 'expectedVersion', p_expected_version)
    );
  end if;
  return v_lead;
end;
$$;

create function jword.add_lead_activity(
  p_owner_id uuid, p_lead_id uuid, p_type public.lead_event_type, p_actor public.actor_type,
  p_summary text, p_metadata jsonb
)
returns uuid language plpgsql set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.lead_activities (user_id, lead_id, type, actor_type, summary, metadata)
  values (p_owner_id, p_lead_id, p_type, p_actor, p_summary, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

create function jword.lock_running_scan(p_owner_id uuid, p_scan_id uuid)
returns public.lead_scans language plpgsql set search_path = '' as $$
declare
  v_scan public.lead_scans%rowtype;
begin
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

-- A scan running longer than this is treated as interrupted (the collector's own budget is
-- far shorter), so a lost process cannot block a board forever.
create function jword.scan_stale_after()
returns interval language sql immutable set search_path = '' as $$ select interval '5 minutes' $$;

-- ---------------------------------------------------------------------------
-- begin_lead_scan: the board must be configured on the owner's watch right now.
-- Returns {scanId, sourceId, startedAt}. One running scan per source at a time.
-- ---------------------------------------------------------------------------
create function public.begin_lead_scan(p_owner_id uuid, p_actor text, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_command jsonb := jword.validate_object('{
    "watchId":{"type":"uuid","required":true},
    "provider":{"type":"enum","values":["GREENHOUSE","LEVER","ASHBY","WORKDAY"],"required":true},
    "boardIdentifier":{"type":"text","max":170,"required":true}
  }'::jsonb, p_command);
  v_provider public.ats_provider := (v_command->>'provider')::public.ats_provider;
  v_board record;
  v_source uuid;
  v_scan public.lead_scans%rowtype;
begin
  select w.id as watch_id, w.company_id, b.board_identifier, b.board_url into v_board
  from public.company_watches w
  join public.company_watch_boards b on b.watch_id = w.id and b.user_id = w.user_id
  where w.user_id = v_owner and w.id = (v_command->>'watchId')::uuid
    and b.provider = v_provider and lower(b.board_identifier) = lower(v_command->>'boardIdentifier');
  if not found then
    perform jword.fail('JW404', 'That board is not on this watched company.', 'BOARD_NOT_WATCHED');
  end if;

  -- The upsert locks the source row, so concurrent begins for one board run one at a time.
  insert into public.lead_sources (user_id, company_id, provider, board_identifier, board_url)
  values (v_owner, v_board.company_id, v_provider, v_board.board_identifier, v_board.board_url)
  on conflict (user_id, provider, board_key) do update
    set company_id = excluded.company_id,
        board_identifier = excluded.board_identifier,
        board_url = excluded.board_url
  returning id into v_source;

  update public.lead_scans
  set status = 'FAILED', reason = 'INTERRUPTED', finished_at = clock_timestamp()
  where user_id = v_owner and source_id = v_source and status = 'RUNNING'
    and started_at < clock_timestamp() - jword.scan_stale_after();
  if exists (
    select 1 from public.lead_scans
    where user_id = v_owner and source_id = v_source and status = 'RUNNING'
  ) then
    perform jword.fail('JW409', 'This board is already being checked.', 'SCAN_IN_PROGRESS');
  end if;

  insert into public.lead_scans (user_id, source_id, watch_id, company_id, actor_type)
  values (v_owner, v_source, v_board.watch_id, v_board.company_id, v_actor)
  returning * into v_scan;
  return jsonb_build_object('scanId', v_scan.id, 'sourceId', v_source, 'startedAt', v_scan.started_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- record_lead_postings: upsert one chunk (at most 500) of a running scan's postings.
-- Inserts new postings; refreshes known ones and makes them available again. Never changes
-- review status, application links, or versions. Returns {created, updated, relisted}.
-- ---------------------------------------------------------------------------
create function public.record_lead_postings(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_spec constant jsonb := '{
    "postingId":{"type":"text","max":500,"required":true},
    "title":{"type":"text","max":500,"required":true},
    "location":{"type":"text","max":500,"nullable":true},
    "jobUrl":{"type":"url","max":2048,"required":true},
    "description":{"type":"text","max":10000,"nullable":true},
    "postedOn":{"type":"text","max":10,"nullable":true}
  }'::jsonb;
  v_scan public.lead_scans%rowtype;
  v_company uuid;
  v_item jsonb;
  v_posting jsonb;
  v_posted date;
  v_lead public.leads%rowtype;
  v_id uuid;
  v_now timestamptz;
  v_seen integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_relisted integer := 0;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object'
    or (select count(*) from jsonb_object_keys(p_command) k where k not in ('scanId', 'postings')) > 0
    or jsonb_typeof(p_command->'postings') is distinct from 'array' then
    perform jword.fail('JW422', 'Send scanId and a postings array.', 'INVALID_COMMAND');
  end if;
  if jsonb_array_length(p_command->'postings') > 500 then
    perform jword.fail('JW422', 'Send at most 500 postings at a time.', 'TOO_MANY_POSTINGS');
  end if;
  perform jword.validate_object('{"scanId":{"type":"uuid","required":true}}'::jsonb,
    p_command - 'postings');
  v_scan := jword.lock_running_scan(v_owner, (p_command->>'scanId')::uuid);
  select company_id into v_company from public.lead_sources
  where user_id = v_owner and id = v_scan.source_id;
  v_now := clock_timestamp();

  for v_item in select value from jsonb_array_elements(p_command->'postings') loop
    v_posting := jword.validate_object(v_spec, v_item);
    v_posted := jword.parse_date(v_posting->>'postedOn', 'postedOn');
    v_seen := v_seen + 1;
    insert into public.leads (
      user_id, source_id, company_id, provider_posting_id, title, location, job_url,
      description, posted_on, first_seen_at, last_seen_at, last_scan_id
    ) values (
      v_owner, v_scan.source_id, v_company, v_posting->>'postingId', v_posting->>'title',
      v_posting->>'location', v_posting->>'jobUrl', v_posting->>'description', v_posted,
      v_now, v_now, v_scan.id
    )
    on conflict (user_id, source_id, provider_posting_id) do nothing
    returning id into v_id;
    if v_id is not null then
      v_created := v_created + 1;
      continue;
    end if;

    select * into v_lead from public.leads
    where user_id = v_owner and source_id = v_scan.source_id
      and provider_posting_id = v_posting->>'postingId'
    for update;
    if v_lead.availability = 'UNAVAILABLE' then
      v_relisted := v_relisted + 1;
    elsif (v_lead.title, v_lead.location, v_lead.job_url, v_lead.description, v_lead.posted_on)
      is distinct from (v_posting->>'title', v_posting->>'location', v_posting->>'jobUrl',
        v_posting->>'description', coalesce(v_posted, v_lead.posted_on)) then
      v_updated := v_updated + 1;
    end if;
    update public.leads
    set title = v_posting->>'title',
        location = v_posting->>'location',
        job_url = v_posting->>'jobUrl',
        description = v_posting->>'description',
        -- Keep a date the provider stated before if it stops sending one.
        posted_on = coalesce(v_posted, posted_on),
        company_id = v_company,
        last_seen_at = v_now,
        last_scan_id = v_scan.id,
        availability = 'AVAILABLE',
        unavailable_at = null
    where id = v_lead.id;
  end loop;

  update public.lead_scans
  set postings_seen = postings_seen + v_seen,
      created_count = created_count + v_created,
      updated_count = updated_count + v_updated,
      relisted_count = relisted_count + v_relisted
  where id = v_scan.id;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'relisted', v_relisted);
end;
$$;

-- ---------------------------------------------------------------------------
-- finish_lead_scan: only COMPLETE marks postings this scan did not see as unavailable.
-- Returns {markedUnavailable}.
-- ---------------------------------------------------------------------------
create function public.finish_lead_scan(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_object('{
    "scanId":{"type":"uuid","required":true},
    "status":{"type":"enum","values":["COMPLETE","PARTIAL","FAILED"],"required":true},
    "reason":{"type":"text","max":40,"nullable":true,"pattern":"^[A-Z_]{1,40}$"},
    "reportedTotal":{"type":"integer","min":0,"max":2147483647,"nullable":true}
  }'::jsonb, p_command);
  v_status public.lead_scan_status := (v_command->>'status')::public.lead_scan_status;
  v_scan public.lead_scans%rowtype;
  v_unavailable integer := 0;
  v_now timestamptz;
begin
  if (v_status = 'COMPLETE') <> (v_command->>'reason' is null) then
    perform jword.fail('JW422', 'Only an incomplete scan has a reason.', 'INVALID_FIELD');
  end if;
  v_scan := jword.lock_running_scan(v_owner, (v_command->>'scanId')::uuid);
  v_now := clock_timestamp();
  if v_status = 'COMPLETE' then
    update public.leads
    set availability = 'UNAVAILABLE', unavailable_at = v_now
    where user_id = v_owner and source_id = v_scan.source_id
      and availability = 'AVAILABLE' and last_seen_at < v_scan.started_at;
    get diagnostics v_unavailable = row_count;
  end if;
  update public.lead_scans
  set status = v_status,
      reason = v_command->>'reason',
      reported_total = (v_command->>'reportedTotal')::integer,
      unavailable_count = v_unavailable,
      finished_at = v_now
  where id = v_scan.id;
  update public.lead_sources
  set last_scan_status = v_status,
      last_scanned_at = v_now,
      last_complete_scan_at = case when v_status = 'COMPLETE' then v_now else last_complete_scan_at end
  where user_id = v_owner and id = v_scan.source_id;
  return jsonb_build_object('markedUnavailable', v_unavailable);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_lead_review_status: Dismiss (NEW -> DISMISSED) or restore (DISMISSED -> NEW).
-- ---------------------------------------------------------------------------
create function jword.set_lead_review_status(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'set_lead_review_status';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_lead public.leads%rowtype;
  v_status public.lead_review_status := (p_command->>'reviewStatus')::public.lead_review_status;
  v_activity uuid;
  v_summary text;
  v_version integer;
begin
  v_existing := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;
  v_lead := jword.lock_lead(p_owner_id, (p_command->>'leadId')::uuid,
    (p_command->>'expectedVersion')::integer);
  if v_lead.review_status = 'PROMOTED' then
    perform jword.fail('JW409', 'An application was already created from this lead.', 'LEAD_PROMOTED');
  end if;
  v_version := v_lead.version;
  if v_lead.review_status = v_status then
    v_summary := format('%s is already %s', v_lead.title, lower(v_status::text));
  else
    v_version := v_version + 1;
    update public.leads
    set review_status = v_status, reviewed_at = now(), version = v_version
    where id = v_lead.id;
    v_summary := format('%s %s', case when v_status = 'DISMISSED' then 'Dismissed' else 'Restored' end, v_lead.title);
    v_activity := jword.add_lead_activity(p_owner_id, v_lead.id,
      case when v_status = 'DISMISSED' then 'LEAD_DISMISSED' else 'LEAD_RESTORED' end::public.lead_event_type,
      v_actor, v_summary,
      jsonb_build_object('before', v_lead.review_status::text, 'after', v_status::text));
  end if;
  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id,
    'noop', v_lead.review_status = v_status,
    'leadId', v_lead.id, 'version', v_version, 'reviewStatus', v_status::text,
    'applicationId', null, 'activityId', v_activity, 'summary', v_summary
  ));
end;
$$;

create function public.set_lead_review_status(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_object('{
    "leadId":{"type":"uuid","required":true},
    "expectedVersion":{"type":"integer","required":true,"min":1,"max":2147483647},
    "reviewStatus":{"type":"enum","values":["NEW","DISMISSED"],"required":true}
  }'::jsonb, p_command);
begin
  return jword.set_lead_review_status(v_owner, p_actor, p_request_id, v_command);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_application_from_lead: one transaction creates a SAVED application from the stored
-- posting (with the usual duplicate check), links it, audits both, and saves the receipt.
-- ---------------------------------------------------------------------------
create function jword.create_application_from_lead(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'create_application_from_lead';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_lead public.leads%rowtype;
  v_source public.lead_sources%rowtype;
  v_company public.companies%rowtype;
  v_created jsonb;
  v_activity uuid;
  v_summary text;
begin
  v_existing := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;
  v_lead := jword.lock_lead(p_owner_id, (p_command->>'leadId')::uuid,
    (p_command->>'expectedVersion')::integer);
  if v_lead.review_status = 'PROMOTED' then
    perform jword.fail('JW409', 'An application was already created from this lead.', 'LEAD_PROMOTED');
  end if;
  select * into v_source from public.lead_sources where user_id = p_owner_id and id = v_lead.source_id;
  select * into v_company from public.companies where user_id = p_owner_id and id = v_lead.company_id;

  v_created := jword.create_tracked_job(p_owner_id, v_actor, jsonb_strip_nulls(jsonb_build_object(
    'company', v_company.name,
    'companyId', v_company.id,
    'title', left(v_lead.title, 200),
    'jobUrl', v_lead.job_url,
    'externalJobId', case when length(v_lead.provider_posting_id) <= 100 then v_lead.provider_posting_id end,
    'location', left(v_lead.location, 200),
    'description', v_lead.description,
    'datePosted', v_lead.posted_on::text,
    'source', jword.provider_label(v_source.provider),
    'allowDuplicate', coalesce((p_command->>'allowDuplicate')::boolean, false)
  )), p_today, 'CREATED', jsonb_build_object('leadId', v_lead.id));

  update public.leads
  set review_status = 'PROMOTED', application_id = (v_created->>'applicationId')::uuid,
      reviewed_at = now(), version = v_lead.version + 1
  where id = v_lead.id;
  v_summary := format('Created application for %s at %s', v_lead.title, v_company.name);
  v_activity := jword.add_lead_activity(p_owner_id, v_lead.id, 'LEAD_PROMOTED', v_actor, v_summary,
    jsonb_build_object('applicationId', v_created->'applicationId', 'before', v_lead.review_status::text));

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'leadId', v_lead.id, 'version', v_lead.version + 1, 'reviewStatus', 'PROMOTED',
    'applicationId', v_created->'applicationId', 'activityId', v_activity, 'summary', v_summary,
    'application', jsonb_build_object(
      'ok', true, 'operation', 'create_application', 'requestId', p_request_id, 'noop', false,
      'applicationId', v_created->'applicationId', 'jobId', v_created->'jobId',
      'companyId', v_created->'companyId', 'activityId', v_created->'activityId', 'version', 1,
      'summary', format('Created %s application at %s', v_created->>'status', v_company.name),
      'changedFields', jsonb_build_array('status', 'dateFound'),
      'before', '{}'::jsonb,
      'after', jsonb_build_object('status', v_created->'status', 'dateFound', v_created->'dateFound')
    )
  ));
end;
$$;

create function public.create_application_from_lead(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_object('{
    "leadId":{"type":"uuid","required":true},
    "expectedVersion":{"type":"integer","required":true,"min":1,"max":2147483647},
    "allowDuplicate":{"type":"boolean"}
  }'::jsonb, p_command);
begin
  return jword.create_application_from_lead(v_owner, p_actor, p_request_id, v_command, p_today);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: only the public wrappers are callable; helpers stay private.
-- ---------------------------------------------------------------------------
revoke all on function jword.lock_lead(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function jword.add_lead_activity(uuid, uuid, public.lead_event_type, public.actor_type, text, jsonb) from public, anon, authenticated;
revoke all on function jword.lock_running_scan(uuid, uuid) from public, anon, authenticated;
revoke all on function jword.scan_stale_after() from public, anon, authenticated;
revoke all on function jword.set_lead_review_status(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function jword.create_application_from_lead(uuid, text, uuid, jsonb, date) from public, anon, authenticated;

revoke all on function public.begin_lead_scan(uuid, text, jsonb) from public, anon;
revoke all on function public.record_lead_postings(uuid, jsonb) from public, anon;
revoke all on function public.finish_lead_scan(uuid, jsonb) from public, anon;
revoke all on function public.set_lead_review_status(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.create_application_from_lead(uuid, text, uuid, jsonb, date) from public, anon;
grant execute on function public.begin_lead_scan(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.record_lead_postings(uuid, jsonb) to authenticated, service_role;
grant execute on function public.finish_lead_scan(uuid, jsonb) to authenticated, service_role;
grant execute on function public.set_lead_review_status(uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.create_application_from_lead(uuid, text, uuid, jsonb, date) to authenticated, service_role;
