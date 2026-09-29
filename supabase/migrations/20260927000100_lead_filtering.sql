-- Decision 026: search preferences and deterministic lead filtering.
--
-- Preferences are owner configuration, separate from the factual candidate profile (the
-- graduation date stays in candidate_profiles). Lead evaluation is computed by the shared,
-- pure TypeScript evaluator and stored here so views, filters, and paging run in SQL.
-- Evaluation never changes a lead's review status, availability, or version.
--
-- Collection: a NEW posting that a hard rule excludes is not stored; it is only counted on
-- its scan by reason. Known postings are always refreshed, whatever their evaluation.

-- ---------------------------------------------------------------------------
-- search_preferences: one row per owner, versioned; audit in search_preference_activities.
-- ---------------------------------------------------------------------------
create table public.search_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  target_level text not null check (target_level in ('NEW_GRAD', 'ANY')),
  employment_target text not null check (employment_target in ('FULL_TIME', 'ANY')),
  preferred_start_month date check (extract(day from preferred_start_month) = 1),
  preferred_cities text[] not null default '{}'
    check (cardinality(preferred_cities) <= 10
      and array_to_string(preferred_cities, ',') ~ '^([A-Z_]{1,40}(,[A-Z_]{1,40})*)?$'),
  hide_remote_only boolean not null,
  preferred_roles text[] not null default '{}'
    check (cardinality(preferred_roles) <= 20
      and array_to_string(preferred_roles, ',') ~ '^([A-Z_]{1,40}(,[A-Z_]{1,40})*)?$'),
  deemphasized_roles text[] not null default '{}'
    check (cardinality(deemphasized_roles) <= 20
      and array_to_string(deemphasized_roles, ',') ~ '^([A-Z_]{1,40}(,[A-Z_]{1,40})*)?$'),
  max_posting_age_days integer check (max_posting_age_days between 1 and 365),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger search_preferences_set_updated_at
  before update on public.search_preferences
  for each row execute function jword.set_updated_at();

create table public.search_preference_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_type public.actor_type not null,
  version integer not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index search_preference_activities_user_idx
  on public.search_preference_activities (user_id, occurred_at desc);

alter table public.search_preferences enable row level security;
alter table public.search_preference_activities enable row level security;
create policy search_preferences_owner_select on public.search_preferences
  for select to authenticated using ((select auth.uid()) = user_id);
create policy search_preference_activities_owner_select on public.search_preference_activities
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.search_preferences, public.search_preference_activities from anon, authenticated;
grant select on public.search_preferences, public.search_preference_activities to authenticated;
grant select, insert, update, delete on public.search_preferences,
  public.search_preference_activities to service_role;

-- ---------------------------------------------------------------------------
-- Lead evaluation columns. match_status is null until a lead is first evaluated; the
-- inbox treats that as eligible (unknown means eligible).
-- ---------------------------------------------------------------------------
create type public.lead_match as enum ('ELIGIBLE', 'UNCERTAIN', 'EXCLUDED');

alter table public.leads
  add column locations text[] not null default '{}'
    check (cardinality(locations) <= 20),
  add column workplace_type text check (workplace_type in ('ONSITE', 'HYBRID', 'REMOTE')),
  add column employment_type text
    check (employment_type in ('FULL_TIME', 'PART_TIME', 'INTERN', 'CONTRACT', 'TEMPORARY')),
  add column match_status public.lead_match,
  add column arrangement text not null default 'UNKNOWN'
    check (arrangement in ('ONSITE', 'HYBRID', 'REMOTE', 'UNKNOWN')),
  add column city_rank smallint check (city_rank between 1 and 10),
  add column role_fit text not null default 'NEUTRAL'
    check (role_fit in ('PREFERRED', 'NEUTRAL', 'DEEMPHASIZED')),
  add column evaluation jsonb check (evaluation is null or jsonb_typeof(evaluation) = 'object'),
  add column evaluation_key text check (evaluation_key ~ '^[a-z0-9:_-]{1,80}$'),
  add column evaluated_at timestamptz;

create index leads_user_evaluation_key_idx on public.leads (user_id, evaluation_key);

alter table public.lead_scans
  add column filtered_count integer not null default 0 check (filtered_count >= 0),
  add column filtered_reasons jsonb not null default '{}'::jsonb
    check (jsonb_typeof(filtered_reasons) = 'object');

-- New columns are appended, so the view keeps its existing column order.
create or replace view public.lead_overview
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
  l.version,
  l.locations,
  l.workplace_type,
  l.employment_type,
  l.match_status,
  l.arrangement,
  l.city_rank,
  l.role_fit,
  l.evaluation,
  l.evaluation_key
from public.leads l
join public.companies c on c.id = l.company_id and c.user_id = l.user_id
join public.lead_sources s on s.id = l.source_id and s.user_id = l.user_id;

-- ---------------------------------------------------------------------------
-- Validation helpers for evaluator output and structured posting fields.
-- ---------------------------------------------------------------------------
create function jword.validate_lead_evaluation(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_eval jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    perform jword.fail('JW422', 'evaluation must be an object.', 'INVALID_FIELD');
  end if;
  v_eval := jword.validate_object('{
    "match":{"type":"enum","values":["ELIGIBLE","UNCERTAIN","EXCLUDED"],"required":true},
    "arrangement":{"type":"enum","values":["ONSITE","HYBRID","REMOTE","UNKNOWN"],"required":true},
    "cityRank":{"type":"integer","min":1,"max":10,"nullable":true},
    "roleFit":{"type":"enum","values":["PREFERRED","NEUTRAL","DEEMPHASIZED"],"required":true},
    "key":{"type":"text","max":80,"required":true,"pattern":"^[a-z0-9:_-]{1,80}$"},
    "primaryReason":{"type":"text","max":40,"nullable":true,"pattern":"^[A-Z_]{1,40}$"}
  }'::jsonb, p_value - 'detail');
  if jsonb_typeof(p_value->'detail') is distinct from 'object'
    or length((p_value->'detail')::text) > 16000 then
    perform jword.fail('JW422', 'evaluation.detail must be a small object.', 'INVALID_FIELD');
  end if;
  if (v_eval->>'match' = 'EXCLUDED') <> (v_eval->>'primaryReason' is not null) then
    perform jword.fail('JW422', 'Only an excluded evaluation has a primary reason.', 'INVALID_FIELD');
  end if;
  return v_eval || jsonb_build_object('detail', p_value->'detail');
end;
$$;

create function jword.parse_locations(p_value jsonb)
returns text[] language plpgsql immutable set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_item jsonb;
begin
  if p_value is null or p_value = 'null'::jsonb then
    return v_out;
  end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 20 then
    perform jword.fail('JW422', 'locations must be an array of at most 20 places.', 'INVALID_FIELD');
  end if;
  for v_item in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_item) <> 'string' or btrim(v_item #>> '{}') = ''
      or length(v_item #>> '{}') > 500 then
      perform jword.fail('JW422', 'Each location must be text of at most 500 characters.', 'INVALID_FIELD');
    end if;
    v_out := v_out || btrim(v_item #>> '{}');
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_lead_postings (replaces decision 024's version): each posting may carry its
-- structured fields and the scan's evaluation. A new posting evaluated EXCLUDED is counted
-- by primary reason and not stored. Known postings are refreshed and re-evaluated whatever
-- the result. Review status, application links, and versions are never changed.
-- ---------------------------------------------------------------------------
create or replace function public.record_lead_postings(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_spec constant jsonb := '{
    "postingId":{"type":"text","max":500,"required":true},
    "title":{"type":"text","max":500,"required":true},
    "location":{"type":"text","max":500,"nullable":true},
    "jobUrl":{"type":"url","max":2048,"required":true},
    "description":{"type":"text","max":10000,"nullable":true},
    "postedOn":{"type":"text","max":10,"nullable":true},
    "workplaceType":{"type":"enum","values":["ONSITE","HYBRID","REMOTE"],"nullable":true},
    "employmentType":{"type":"enum","values":["FULL_TIME","PART_TIME","INTERN","CONTRACT","TEMPORARY"],"nullable":true}
  }'::jsonb;
  v_scan public.lead_scans%rowtype;
  v_company uuid;
  v_item jsonb;
  v_posting jsonb;
  v_eval jsonb;
  v_locations text[];
  v_posted date;
  v_lead public.leads%rowtype;
  v_id uuid;
  v_now timestamptz;
  v_seen integer := 0;
  v_created integer := 0;
  v_updated integer := 0;
  v_relisted integer := 0;
  v_filtered integer := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_reason text;
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
    if jsonb_typeof(v_item) <> 'object' then
      perform jword.fail('JW422', 'Each posting must be an object.', 'INVALID_COMMAND');
    end if;
    v_posting := jword.validate_object(v_spec, v_item - 'locations' - 'evaluation');
    v_locations := jword.parse_locations(v_item->'locations');
    v_eval := case when v_item ? 'evaluation' and v_item->'evaluation' <> 'null'::jsonb
      then jword.validate_lead_evaluation(v_item->'evaluation') end;
    v_posted := jword.parse_date(v_posting->>'postedOn', 'postedOn');
    v_seen := v_seen + 1;

    -- One running scan per source (locked above), so this existence check cannot race.
    select * into v_lead from public.leads
    where user_id = v_owner and source_id = v_scan.source_id
      and provider_posting_id = v_posting->>'postingId'
    for update;

    if not found then
      if v_eval->>'match' = 'EXCLUDED' then
        v_filtered := v_filtered + 1;
        v_reason := v_eval->>'primaryReason';
        v_reasons := jsonb_set(v_reasons, array[v_reason],
          to_jsonb(coalesce((v_reasons->>v_reason)::integer, 0) + 1));
        continue;
      end if;
      insert into public.leads (
        user_id, source_id, company_id, provider_posting_id, title, location, job_url,
        description, posted_on, first_seen_at, last_seen_at, last_scan_id,
        locations, workplace_type, employment_type,
        match_status, arrangement, city_rank, role_fit, evaluation, evaluation_key, evaluated_at
      ) values (
        v_owner, v_scan.source_id, v_company, v_posting->>'postingId', v_posting->>'title',
        v_posting->>'location', v_posting->>'jobUrl', v_posting->>'description', v_posted,
        v_now, v_now, v_scan.id,
        v_locations, v_posting->>'workplaceType', v_posting->>'employmentType',
        (v_eval->>'match')::public.lead_match, coalesce(v_eval->>'arrangement', 'UNKNOWN'),
        (v_eval->>'cityRank')::smallint, coalesce(v_eval->>'roleFit', 'NEUTRAL'),
        v_eval->'detail', v_eval->>'key', case when v_eval is not null then v_now end
      );
      v_created := v_created + 1;
      continue;
    end if;

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
        unavailable_at = null,
        locations = v_locations,
        workplace_type = v_posting->>'workplaceType',
        employment_type = v_posting->>'employmentType',
        match_status = coalesce((v_eval->>'match')::public.lead_match, match_status),
        arrangement = coalesce(v_eval->>'arrangement', arrangement),
        city_rank = case when v_eval is null then city_rank else (v_eval->>'cityRank')::smallint end,
        role_fit = coalesce(v_eval->>'roleFit', role_fit),
        evaluation = coalesce(v_eval->'detail', evaluation),
        evaluation_key = coalesce(v_eval->>'key', evaluation_key),
        evaluated_at = case when v_eval is null then evaluated_at else v_now end
    where id = v_lead.id;
  end loop;

  update public.lead_scans s
  set postings_seen = s.postings_seen + v_seen,
      created_count = s.created_count + v_created,
      updated_count = s.updated_count + v_updated,
      relisted_count = s.relisted_count + v_relisted,
      filtered_count = s.filtered_count + v_filtered,
      filtered_reasons = (
        select coalesce(jsonb_object_agg(k, total), '{}'::jsonb)
        from (
          select k, sum(v::integer) as total
          from (
            select key as k, value as v from jsonb_each_text(s.filtered_reasons)
            union all
            select key, value from jsonb_each_text(v_reasons)
          ) merged
          group by k
        ) sums
      )
  where s.id = v_scan.id;
  return jsonb_build_object('created', v_created, 'updated', v_updated, 'relisted', v_relisted,
    'filtered', v_filtered, 'filteredReasons', v_reasons);
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_lead_evaluations: store re-evaluations (after a preference edit, a rule change, or a
-- scan that used an older snapshot). Refuses a stale preferences version so an old
-- re-evaluation can never overwrite a newer one. Touches evaluation columns only.
-- ---------------------------------------------------------------------------
create function public.apply_lead_evaluations(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb;
  v_current integer;
  v_item jsonb;
  v_eval jsonb;
  v_now timestamptz := clock_timestamp();
  v_updated integer := 0;
  v_count integer;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object'
    or jsonb_typeof(p_command->'evaluations') is distinct from 'array' then
    perform jword.fail('JW422', 'Send preferencesVersion and an evaluations array.', 'INVALID_COMMAND');
  end if;
  if jsonb_array_length(p_command->'evaluations') > 500 then
    perform jword.fail('JW422', 'Send at most 500 evaluations at a time.', 'TOO_MANY_EVALUATIONS');
  end if;
  v_command := jword.validate_object(
    '{"preferencesVersion":{"type":"integer","min":0,"max":2147483647,"required":true}}'::jsonb,
    p_command - 'evaluations');
  -- Serializes with save_search_preferences for this owner.
  select version into v_current from public.search_preferences where user_id = v_owner for share;
  if coalesce(v_current, 0) <> (v_command->>'preferencesVersion')::integer then
    perform jword.fail('JW409', 'Preferences changed during re-evaluation.', 'STALE_PREFERENCES',
      jsonb_build_object('currentVersion', coalesce(v_current, 0)));
  end if;

  for v_item in select value from jsonb_array_elements(p_command->'evaluations') loop
    perform jword.validate_object('{"leadId":{"type":"uuid","required":true}}'::jsonb,
      v_item - 'evaluation');
    v_eval := jword.validate_lead_evaluation(v_item->'evaluation');
    update public.leads
    set match_status = (v_eval->>'match')::public.lead_match,
        arrangement = v_eval->>'arrangement',
        city_rank = (v_eval->>'cityRank')::smallint,
        role_fit = v_eval->>'roleFit',
        evaluation = v_eval->'detail',
        evaluation_key = v_eval->>'key',
        evaluated_at = v_now
    where user_id = v_owner and id = (v_item->>'leadId')::uuid;
    get diagnostics v_count = row_count;
    v_updated := v_updated + v_count;
  end loop;
  return jsonb_build_object('updated', v_updated);
end;
$$;

-- ---------------------------------------------------------------------------
-- save_search_preferences: create (no expectedVersion) or replace the whole set, with a
-- version check, request receipt, and audit row, in one transaction.
-- ---------------------------------------------------------------------------
create function jword.save_search_preferences(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'save_search_preferences';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_row public.search_preferences%rowtype;
  v_found boolean;
  v_before jsonb;
  v_after jsonb;
  v_version integer;
  v_activity uuid;
  v_summary text;
  v_noop boolean := false;
  v_expected integer := (p_command->>'expectedVersion')::integer;
begin
  v_existing := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;
  select * into v_row from public.search_preferences where user_id = p_owner_id for update;
  v_found := found;
  if v_found and v_expected is null then
    perform jword.fail('JW409', 'Preferences were saved elsewhere. Refresh before saving.',
      'STALE_VERSION', jsonb_build_object('currentVersion', v_row.version));
  end if;
  if not v_found and v_expected is not null then
    perform jword.fail('JW409', 'Preferences changed since you opened them. Refresh before saving.',
      'STALE_VERSION', jsonb_build_object('currentVersion', 0, 'expectedVersion', v_expected));
  end if;
  if v_found and v_row.version <> v_expected then
    perform jword.fail('JW409', 'Preferences changed since you opened them. Refresh before saving.',
      'STALE_VERSION', jsonb_build_object('currentVersion', v_row.version, 'expectedVersion', v_expected));
  end if;

  v_after := p_command - 'expectedVersion';
  if v_found then
    v_before := jsonb_build_object(
      'targetLevel', v_row.target_level,
      'employmentTarget', v_row.employment_target,
      'preferredStartMonth', to_char(v_row.preferred_start_month, 'YYYY-MM'),
      'preferredCities', to_jsonb(v_row.preferred_cities),
      'hideRemoteOnly', v_row.hide_remote_only,
      'preferredRoles', to_jsonb(v_row.preferred_roles),
      'deemphasizedRoles', to_jsonb(v_row.deemphasized_roles),
      'maxPostingAgeDays', v_row.max_posting_age_days
    );
    v_noop := v_before = v_after;
  end if;

  if v_noop then
    v_version := v_row.version;
    v_summary := 'Search preferences unchanged';
  else
    insert into public.search_preferences as p (
      user_id, target_level, employment_target, preferred_start_month, preferred_cities,
      hide_remote_only, preferred_roles, deemphasized_roles, max_posting_age_days
    ) values (
      p_owner_id, v_after->>'targetLevel', v_after->>'employmentTarget',
      (nullif(v_after->>'preferredStartMonth', '') || '-01')::date,
      array(select jsonb_array_elements_text(v_after->'preferredCities')),
      (v_after->>'hideRemoteOnly')::boolean,
      array(select jsonb_array_elements_text(v_after->'preferredRoles')),
      array(select jsonb_array_elements_text(v_after->'deemphasizedRoles')),
      (v_after->>'maxPostingAgeDays')::integer
    )
    on conflict (user_id) do update set
      target_level = excluded.target_level,
      employment_target = excluded.employment_target,
      preferred_start_month = excluded.preferred_start_month,
      preferred_cities = excluded.preferred_cities,
      hide_remote_only = excluded.hide_remote_only,
      preferred_roles = excluded.preferred_roles,
      deemphasized_roles = excluded.deemphasized_roles,
      max_posting_age_days = excluded.max_posting_age_days,
      version = p.version + 1
    returning version into v_version;
    v_summary := case when v_found then 'Updated search preferences' else 'Saved search preferences' end;
    insert into public.search_preference_activities (user_id, actor_type, version, summary, metadata)
    values (p_owner_id, v_actor, v_version, v_summary,
      jsonb_build_object('before', v_before, 'after', v_after))
    returning id into v_activity;
  end if;

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', v_noop,
    'version', v_version, 'activityId', v_activity, 'summary', v_summary
  ));
end;
$$;

create function public.save_search_preferences(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb;
  v_key text;
  v_list text;
  v_values text[];
  v_max integer;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    perform jword.fail('JW422', 'Command must be an object.', 'INVALID_COMMAND');
  end if;
  v_command := jword.validate_object('{
    "expectedVersion":{"type":"integer","min":1,"max":2147483647},
    "targetLevel":{"type":"enum","values":["NEW_GRAD","ANY"],"required":true},
    "employmentTarget":{"type":"enum","values":["FULL_TIME","ANY"],"required":true},
    "preferredStartMonth":{"type":"text","max":7,"nullable":true,"pattern":"^[0-9]{4}-(0[1-9]|1[0-2])$"},
    "hideRemoteOnly":{"type":"boolean","required":true},
    "maxPostingAgeDays":{"type":"integer","min":1,"max":365,"nullable":true}
  }'::jsonb, p_command - 'preferredCities' - 'preferredRoles' - 'deemphasizedRoles');
  if not (p_command ? 'preferredStartMonth') or not (p_command ? 'maxPostingAgeDays') then
    perform jword.fail('JW422', 'Send every preference field.', 'REQUIRED_FIELD');
  end if;
  foreach v_list in array array['preferredCities', 'preferredRoles', 'deemphasizedRoles'] loop
    v_max := 20;
    if v_list = 'preferredCities' then
      v_max := 10;
    end if;
    if jsonb_typeof(p_command->v_list) is distinct from 'array'
      or jsonb_array_length(p_command->v_list) > v_max then
      perform jword.fail('JW422', format('%s must be a short list.', v_list), 'INVALID_FIELD');
    end if;
    v_values := '{}';
    for v_key in select value #>> '{}' from jsonb_array_elements(p_command->v_list) loop
      if v_key is null or v_key !~ '^[A-Z_]{1,40}$' or v_key = any (v_values) then
        perform jword.fail('JW422', format('%s has an invalid or repeated value.', v_list), 'INVALID_FIELD');
      end if;
      v_values := v_values || v_key;
    end loop;
    v_command := v_command || jsonb_build_object(v_list, p_command->v_list);
  end loop;
  return jword.save_search_preferences(v_owner, p_actor, p_request_id, v_command);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function jword.validate_lead_evaluation(jsonb) from public, anon, authenticated;
revoke all on function jword.parse_locations(jsonb) from public, anon, authenticated;
revoke all on function jword.save_search_preferences(uuid, text, uuid, jsonb) from public, anon, authenticated;

revoke all on function public.apply_lead_evaluations(uuid, jsonb) from public, anon;
revoke all on function public.save_search_preferences(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.apply_lead_evaluations(uuid, jsonb) to authenticated, service_role;
grant execute on function public.save_search_preferences(uuid, text, uuid, jsonb) to authenticated, service_role;
