-- Harden decision 026 without rewriting the migration already applied locally.
-- Review versions remain user-facing; input_revision protects derived evaluations only.
alter table public.leads add column input_revision integer not null default 1 check (input_revision > 0);

create function jword.bump_lead_input_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.title, new.location, new.locations, new.workplace_type, new.employment_type, new.description)
     is distinct from row(old.title, old.location, old.locations, old.workplace_type, old.employment_type, old.description) then
    new.input_revision := old.input_revision + 1;
  else
    new.input_revision := old.input_revision;
  end if;
  return new;
end;
$$;
create trigger leads_input_revision before update on public.leads
  for each row execute function jword.bump_lead_input_revision();
revoke all on function jword.bump_lead_input_revision() from public, anon, authenticated;

-- Unlike a row lock, this also protects the first save when no settings/profile row exists.
-- All settings writers acquire this before row locks; evaluation holds it through its writes.
create function jword.lock_lead_settings(p_owner_id uuid)
returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('jword:lead_settings:' || p_owner_id::text, 0));
$$;
revoke all on function jword.lock_lead_settings(uuid) from public, anon, authenticated;

create or replace function public.save_candidate_profile(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('save_candidate_profile', p_command);
begin
  perform jword.lock_lead_settings(v_owner);
  return jword.save_candidate_profile(v_owner, v_command);
end;
$$;

create or replace function public.save_search_preferences(
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
  perform jword.lock_lead_settings(v_owner);
  return jword.save_search_preferences(v_owner, p_actor, p_request_id, v_command);
end;
$$;

-- Both RPCs that accept evaluator output use this validator. JSON objects alone are not
-- enough: malformed nested arrays used to be persisted and crash the Leads renderer.
create or replace function jword.validate_lead_evaluation(p_value jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_eval jsonb;
  v_detail jsonb;
  v_list text;
  v_item jsonb;
  v_allowed jsonb;
  v_seen text[];
  v_code text;
  v_match text;
  v_scalar constant jsonb := '{
    "match":{"type":"enum","values":["ELIGIBLE","UNCERTAIN","EXCLUDED"],"required":true},
    "arrangement":{"type":"enum","values":["ONSITE","HYBRID","REMOTE","UNKNOWN"],"required":true},
    "cityRank":{"type":"integer","min":1,"max":10,"nullable":true,"required":true},
    "roleFit":{"type":"enum","values":["PREFERRED","NEUTRAL","DEEMPHASIZED"],"required":true}
  }'::jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    perform jword.fail('JW422', 'evaluation must be an object.', 'INVALID_FIELD');
  end if;
  v_eval := jword.validate_object(v_scalar || '{
    "key":{"type":"text","max":80,"required":true,"pattern":"^[a-z0-9:_-]{1,80}$"},
    "primaryReason":{"type":"enum","values":["INTERNSHIP","SENIORITY","MANAGEMENT","UNRELATED_OCCUPATION","GRADUATION_WINDOW"],"nullable":true,"required":true}
  }'::jsonb, p_value - 'detail');
  v_detail := p_value->'detail';
  if jsonb_typeof(v_detail) is distinct from 'object' or length(v_detail::text) > 16000 then
    perform jword.fail('JW422', 'evaluation.detail must be a small object.', 'INVALID_FIELD');
  end if;
  perform jword.validate_object(v_scalar || '{
    "arrangementField":{"type":"enum","values":["title","employmentType","description","location","workplaceType","profile"],"nullable":true,"required":true},
    "startMonth":{"type":"text","max":7,"pattern":"^[0-9]{4}-(0[1-9]|1[0-2])$","nullable":true,"required":true},
    "startFit":{"type":"enum","values":["PREFERRED","EARLIER"],"nullable":true,"required":true}
  }'::jsonb, v_detail - 'exclusions' - 'flags' - 'cities' - 'roleFamilies');

  foreach v_list in array array['exclusions', 'flags', 'cities', 'roleFamilies'] loop
    if jsonb_typeof(v_detail->v_list) is distinct from 'array' then
      perform jword.fail('JW422', 'Evaluation findings and labels must be arrays.', 'INVALID_FIELD');
    end if;
    v_allowed := case v_list
      when 'exclusions' then '["INTERNSHIP","SENIORITY","MANAGEMENT","UNRELATED_OCCUPATION","GRADUATION_WINDOW"]'::jsonb
      when 'flags' then '["LEVEL_UNCLEAR","OCCUPATION_UNCLEAR","GRADUATION_UNCLEAR","EXPERIENCE_MENTIONED","EMPLOYMENT_TYPE_OTHER","ELIGIBILITY_OUTSIDE_US"]'::jsonb
      when 'cities' then '["SAN_FRANCISCO","NEW_YORK","CHICAGO","BOSTON","SEATTLE","AUSTIN","LOS_ANGELES","SAN_JOSE_PENINSULA","WASHINGTON_DC","DENVER","ATLANTA","LONDON","TORONTO"]'::jsonb
      else '["BACKEND","FRONTEND","FULL_STACK","PLATFORM_INFRA","AI_ML","DATA","MOBILE","SECURITY","EMBEDDED"]'::jsonb end;
    if jsonb_array_length(v_detail->v_list) > least(jsonb_array_length(v_allowed), 10) then
      perform jword.fail('JW422', 'Too many evaluation findings or labels.', 'INVALID_FIELD');
    end if;
    v_seen := '{}';
    for v_item in select value from jsonb_array_elements(v_detail->v_list) loop
      if v_list in ('exclusions', 'flags') then
        perform jword.validate_object('{
          "code":{"type":"text","max":40,"required":true},
          "field":{"type":"enum","values":["title","employmentType","description","location","workplaceType","profile"],"required":true},
          "evidence":{"type":"text","max":160,"required":true}
        }'::jsonb, v_item);
        v_code := v_item->>'code';
      else
        if jsonb_typeof(v_item) <> 'string' then
          perform jword.fail('JW422', 'Evaluation labels must be text.', 'INVALID_FIELD');
        end if;
        v_code := v_item #>> '{}';
      end if;
      if not (v_allowed ? v_code) or v_code = any(v_seen) then
        perform jword.fail('JW422', 'Unknown or repeated evaluation label.', 'INVALID_FIELD');
      end if;
      v_seen := v_seen || v_code;
    end loop;
  end loop;

  v_match := case when jsonb_array_length(v_detail->'exclusions') > 0 then 'EXCLUDED'
    when jsonb_array_length(v_detail->'flags') > 0 then 'UNCERTAIN' else 'ELIGIBLE' end;
  if v_detail->>'match' <> v_match
    or v_eval->'match' is distinct from v_detail->'match'
    or v_eval->'arrangement' is distinct from v_detail->'arrangement'
    or v_eval->'cityRank' is distinct from v_detail->'cityRank'
    or v_eval->'roleFit' is distinct from v_detail->'roleFit'
    or v_eval->>'primaryReason' is distinct from v_detail->'exclusions'->0->>'code'
    or (v_detail->>'cityRank' is null) <> (jsonb_array_length(v_detail->'cities') = 0)
    or (v_detail->>'arrangement' = 'UNKNOWN') <> (v_detail->>'arrangementField' is null)
    or (v_detail->>'startFit' is not null and v_detail->>'startMonth' is null) then
    perform jword.fail('JW422', 'Evaluation labels disagree with their findings.', 'INVALID_FIELD');
  end if;
  return v_eval || jsonb_build_object('detail', v_detail);
end;
$$;

create or replace function public.apply_lead_evaluations(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb;
  v_current integer;
  v_graduation date;
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
    '{"preferencesVersion":{"type":"integer","min":0,"max":2147483647,"required":true},"graduationDate":{"type":"text","max":10,"nullable":true,"required":true,"pattern":"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"}}'::jsonb,
    p_command - 'evaluations');
  perform jword.lock_lead_settings(v_owner);
  -- Serializes with preference and profile saves, including their first insert.
  select version into v_current from public.search_preferences where user_id = v_owner for share;
  if coalesce(v_current, 0) <> (v_command->>'preferencesVersion')::integer then
    perform jword.fail('JW409', 'Preferences changed during re-evaluation.', 'STALE_PREFERENCES',
      jsonb_build_object('currentVersion', coalesce(v_current, 0)));
  end if;

  select graduation_date into v_graduation from public.candidate_profiles where user_id = v_owner;
  if v_graduation is distinct from (v_command->>'graduationDate')::date then
    perform jword.fail('JW409', 'Graduation date changed during re-evaluation.', 'STALE_PROFILE');
  end if;

  for v_item in select value from jsonb_array_elements(p_command->'evaluations') loop
    perform jword.validate_object('{"leadId":{"type":"uuid","required":true},"expectedInputRevision":{"type":"integer","min":1,"max":2147483647,"required":true}}'::jsonb,
      v_item - 'evaluation');
    v_eval := jword.validate_lead_evaluation(v_item->'evaluation');
    if (v_eval->>'key') !~ ('^e[0-9]+:p' || coalesce(v_current, 0)::text || ':g' || coalesce(to_char(v_graduation, 'YYYY-MM'), '-') || '$') then
      perform jword.fail('JW422', 'Evaluation key does not match its settings.', 'INVALID_FIELD');
    end if;
    update public.leads
    set match_status = (v_eval->>'match')::public.lead_match,
        arrangement = v_eval->>'arrangement',
        city_rank = (v_eval->>'cityRank')::smallint,
        role_fit = v_eval->>'roleFit',
        evaluation = v_eval->'detail',
        evaluation_key = v_eval->>'key',
        evaluated_at = v_now
    where user_id = v_owner and id = (v_item->>'leadId')::uuid
      and input_revision = (v_item->>'expectedInputRevision')::integer;
    get diagnostics v_count = row_count;
    v_updated := v_updated + v_count;
  end loop;
  return jsonb_build_object('updated', v_updated);
end;
$$;
