-- Multiple job boards per watched company (decision 019, JWO-16 follow-up).
--
-- Decision 018 stored one board on each watch. The owner asked for automatic board discovery
-- and up to three boards per company, so boards move to a child table. A watch stays the
-- company-level unit (active flag, version, audit); its boards are replaced as one set inside
-- the same transaction, version check, audit row, and retry receipt.

-- ---------------------------------------------------------------------------
-- company_watch_boards
-- ---------------------------------------------------------------------------
create table public.company_watch_boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  watch_id uuid not null,
  -- 1..3: the database itself caps a watch at three boards.
  position smallint not null check (position between 1 and 3),
  provider public.ats_provider not null,
  board_identifier text,
  board_url text not null,
  created_at timestamptz not null default now(),
  constraint company_watch_boards_watch_position_key unique (watch_id, position),
  constraint company_watch_boards_watch_url_key unique (watch_id, board_url),
  constraint company_watch_boards_watch_owner_fkey foreign key (user_id, watch_id)
    references public.company_watches (user_id, id) on delete cascade,
  -- Mirrors packages/core/src/watchlist/boards.ts. OTHER is a careers page with no identifier.
  constraint company_watch_boards_shape check (
    (provider = 'OTHER' and board_identifier is null)
    or (
      provider <> 'OTHER'
      and board_identifier is not null
      and board_identifier ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
      and board_url = case provider
        when 'GREENHOUSE' then 'https://job-boards.greenhouse.io/' || board_identifier
        when 'LEVER' then 'https://jobs.lever.co/' || board_identifier
        when 'ASHBY' then 'https://jobs.ashbyhq.com/' || board_identifier
      end
    )
  ),
  constraint company_watch_boards_url_http check (
    board_url ~* '^https?://[^[:space:]]+$' and length(board_url) <= 2048
  )
);
-- A board belongs to one watched company per owner, so collection never reads it twice.
create unique index company_watch_boards_user_board_key
  on public.company_watch_boards (user_id, provider, lower(board_identifier))
  where board_identifier is not null;
create index company_watch_boards_user_watch_idx
  on public.company_watch_boards (user_id, watch_id, position);

-- Carry existing single-board configuration over. An OTHER watch without a careers URL simply
-- has no boards now.
insert into public.company_watch_boards (user_id, watch_id, position, provider, board_identifier, board_url)
select user_id, id, 1, provider, board_identifier, board_url
from public.company_watches
where board_url is not null;

-- ---------------------------------------------------------------------------
-- Remove the single-board columns from company_watches.
-- ---------------------------------------------------------------------------
drop view public.company_watch_overview;
drop index public.company_watches_user_board_key;
alter table public.company_watches
  drop constraint company_watches_board_shape,
  drop constraint company_watches_board_url_http,
  drop column provider,
  drop column board_identifier,
  drop column board_url;

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
  w.active,
  w.version,
  w.created_at,
  w.updated_at,
  coalesce(b.boards, '[]'::jsonb) as boards,
  coalesce(b.providers, '{}'::public.ats_provider[]) as board_providers,
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
  select
    jsonb_agg(
      jsonb_build_object(
        'provider', x.provider, 'boardIdentifier', x.board_identifier, 'boardUrl', x.board_url
      ) order by x.position
    ) as boards,
    array_agg(distinct x.provider) as providers
  from public.company_watch_boards x
  where x.user_id = w.user_id and x.watch_id = w.id
) b on true
left join lateral (
  select x.type, x.actor_type, x.summary, x.occurred_at
  from public.company_watch_activities x
  where x.user_id = w.user_id and x.watch_id = w.id
  order by x.occurred_at desc, x.created_at desc
  limit 1
) last_event on true;

-- ---------------------------------------------------------------------------
-- RLS and grants (decision 010): owners read; writes only through the functions.
-- ---------------------------------------------------------------------------
alter table public.company_watch_boards enable row level security;
create policy company_watch_boards_owner_select on public.company_watch_boards
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.company_watch_boards, public.company_watch_overview from anon, authenticated;
grant select on public.company_watch_boards, public.company_watch_overview to authenticated;
grant select, insert, update, delete on public.company_watch_boards to service_role;
grant select on public.company_watch_overview to service_role;

-- ---------------------------------------------------------------------------
-- Validation: the command now carries a `boards` array of up to three boards.
-- ---------------------------------------------------------------------------
create or replace function jword.validate_watch_command(p_operation text, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_company constant jsonb := $c${
    "interestLevel": {"type": "integer", "min": 1, "max": 5, "nullable": true},
    "websiteUrl": {"type": "url", "max": 2048, "nullable": true},
    "companyNotes": {"type": "text", "max": 5000, "nullable": true}
  }$c$::jsonb;
  v_board constant jsonb := $b${
    "provider": {"type": "enum", "values": ["GREENHOUSE", "LEVER", "ASHBY", "OTHER"], "required": true},
    "boardIdentifier": {"type": "text", "max": 100, "nullable": true, "pattern": "^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$"},
    "boardUrl": {"type": "url", "max": 2048, "nullable": true}
  }$b$::jsonb;
  v_existing constant jsonb := $e${
    "watchId": {"type": "uuid", "required": true},
    "expectedVersion": {"type": "integer", "required": true, "min": 1, "max": 2147483647}
  }$e$::jsonb;
  v_result jsonb;
  v_boards jsonb := '[]'::jsonb;
  v_item jsonb;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    perform jword.fail('JW422', 'Command must be an object.', 'INVALID_COMMAND');
  end if;
  if p_operation in ('create_company_watch', 'update_company_watch') and p_command ? 'boards' then
    if jsonb_typeof(p_command->'boards') <> 'array' then
      perform jword.fail('JW422', 'boards must be an array.', 'INVALID_FIELD');
    end if;
    if jsonb_array_length(p_command->'boards') > 3 then
      perform jword.fail('JW422', 'A company can have at most three boards.', 'TOO_MANY_BOARDS');
    end if;
    for v_item in select value from jsonb_array_elements(p_command->'boards') loop
      v_boards := v_boards || jsonb_build_array(jword.validate_object(v_board, v_item));
    end loop;
  end if;
  case p_operation
    when 'create_company_watch' then
      v_result := jword.validate_object(
        v_company || '{"company": {"type": "text", "max": 200}, "companyId": {"type": "uuid"}}'::jsonb,
        p_command - 'boards'
      );
      if not (v_result ? 'company' or v_result ? 'companyId') then
        perform jword.fail('JW422', 'Company is required.', 'COMPANY_REQUIRED');
      end if;
    when 'update_company_watch' then
      v_result := jword.validate_object(v_company || v_existing, p_command - 'boards');
      if v_result - 'watchId' - 'expectedVersion' = '{}'::jsonb and not (p_command ? 'boards') then
        perform jword.fail('JW422', 'Supply at least one editable field.', 'EMPTY_UPDATE');
      end if;
    when 'set_company_watch_active' then
      return jword.validate_object(
        v_existing || '{"active": {"type": "boolean", "required": true}}'::jsonb,
        p_command
      );
    else
      perform jword.fail('JW422', 'Unknown operation.', 'INVALID_OPERATION');
  end case;
  if p_command ? 'boards' then
    v_result := v_result || jsonb_build_object('boards', v_boards);
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Board helpers
-- ---------------------------------------------------------------------------
drop function jword.assert_board_free(uuid, public.ats_provider, text, uuid);
create function jword.assert_board_free(
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
  select b.watch_id, c.name into v_watch_id, v_company
  from public.company_watch_boards b
  join public.company_watches w on w.id = b.watch_id and w.user_id = b.user_id
  join public.companies c on c.id = w.company_id and c.user_id = w.user_id
  where b.user_id = p_owner_id
    and b.provider = p_provider
    and lower(b.board_identifier) = lower(p_identifier)
    and b.watch_id is distinct from p_exclude_watch;
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

-- Validate a proposed board set: shape per board, no duplicates, not watched elsewhere.
-- Returns the canonical list [{provider, boardIdentifier, boardUrl}] in the given order.
create or replace function jword.normalize_boards(p_owner_id uuid, p_boards jsonb, p_watch_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_provider public.ats_provider;
  v_identifier text;
  v_url text;
  v_seen text[] := '{}';
  v_key text;
  v_result jsonb := '[]'::jsonb;
begin
  for v_item in select value from jsonb_array_elements(coalesce(p_boards, '[]'::jsonb)) loop
    v_provider := (v_item->>'provider')::public.ats_provider;
    v_identifier := jword.clean_text(v_item->>'boardIdentifier');
    v_url := jword.resolve_board_url(v_provider, v_identifier, jword.clean_text(v_item->>'boardUrl'));
    if v_url is null then
      perform jword.fail('JW422', 'An Other board needs its careers page URL.', 'BOARD_URL_REQUIRED');
    end if;
    v_key := case when v_identifier is null then lower(v_url) else v_provider::text || ':' || lower(v_identifier) end;
    if v_key = any (v_seen) then
      perform jword.fail('JW422', 'The same board is listed twice.', 'DUPLICATE_BOARD');
    end if;
    v_seen := v_seen || v_key;
    perform jword.assert_board_free(p_owner_id, v_provider, v_identifier, p_watch_id);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'provider', v_provider, 'boardIdentifier', v_identifier, 'boardUrl', v_url
    ));
  end loop;
  return v_result;
end;
$$;

create or replace function jword.current_boards(p_owner_id uuid, p_watch_id uuid)
returns jsonb language sql stable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'provider', provider, 'boardIdentifier', board_identifier, 'boardUrl', board_url
  ) order by position), '[]'::jsonb)
  from public.company_watch_boards
  where user_id = p_owner_id and watch_id = p_watch_id;
$$;

-- Replace a watch's boards with a normalized set (config rows; the audit keeps before/after).
create or replace function jword.write_boards(p_owner_id uuid, p_watch_id uuid, p_boards jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  delete from public.company_watch_boards where user_id = p_owner_id and watch_id = p_watch_id;
  insert into public.company_watch_boards (user_id, watch_id, position, provider, board_identifier, board_url)
  select p_owner_id, p_watch_id, ordinality::smallint,
    (value->>'provider')::public.ats_provider, value->>'boardIdentifier', value->>'boardUrl'
  from jsonb_array_elements(p_boards) with ordinality;
end;
$$;

-- "Greenhouse stripe, Lever stripe" for summaries and scalar before/after values.
create or replace function jword.boards_label(p_boards jsonb)
returns text language sql immutable set search_path = '' as $$
  select coalesce(string_agg(
    case when value->>'provider' = 'OTHER' then 'careers page'
      else jword.provider_label((value->>'provider')::public.ats_provider) || ' ' || (value->>'boardIdentifier') end,
    ', ' order by ordinality), 'no job board')
  from jsonb_array_elements(coalesce(p_boards, '[]'::jsonb)) with ordinality;
$$;

-- ---------------------------------------------------------------------------
-- Private implementations (replace decision-018 versions)
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
  v_boards jsonb;
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

  v_boards := jword.normalize_boards(p_owner_id, p_command->'boards', null);

  begin
    insert into public.company_watches (user_id, company_id)
    values (p_owner_id, v_company.id)
    returning * into v_watch;
    perform jword.write_boards(p_owner_id, v_watch.id, v_boards);
  exception when unique_violation then
    -- A concurrent save won the race; report it the same way as the checks above.
    select * into v_existing from public.company_watches
    where user_id = p_owner_id and company_id = v_company.id;
    if found then
      perform jword.fail('JW409', format('%s is already on your watchlist.', v_company.name), 'ALREADY_WATCHED',
        jsonb_build_object('watchId', v_existing.id, 'watchActive', v_existing.active, 'currentVersion', v_existing.version));
    end if;
    perform jword.normalize_boards(p_owner_id, v_boards, null);
    raise;
  end;

  v_company_changes := jword.apply_company_fields(p_owner_id, v_company, p_command);
  v_changed := '["active", "boards"]'::jsonb || (v_company_changes->'changed');
  v_after := jsonb_build_object('active', true, 'boards', jword.boards_label(v_boards))
    || (v_company_changes->'after');
  v_summary := format('Started watching %s (%s)', v_company.name, jword.boards_label(v_boards));
  v_activity_id := jword.add_watch_activity(
    p_owner_id, v_watch.id, 'WATCH_CREATED', v_actor, v_summary,
    jsonb_build_object(
      'companyId', v_company.id, 'companyCreated', v_company_created, 'fields', v_changed,
      'before', v_company_changes->'before', 'after', v_after, 'boards', v_boards
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
  v_old_boards jsonb;
  v_new_boards jsonb;
  v_changed jsonb := '[]'::jsonb;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_metadata jsonb := '{}'::jsonb;
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

  if p_command ? 'boards' then
    v_old_boards := jword.current_boards(p_owner_id, v_watch.id);
    v_new_boards := jword.normalize_boards(p_owner_id, p_command->'boards', v_watch.id);
    if v_new_boards <> v_old_boards then
      v_changed := v_changed || '"boards"'::jsonb;
      v_before := v_before || jsonb_build_object('boards', jword.boards_label(v_old_boards));
      v_after := v_after || jsonb_build_object('boards', jword.boards_label(v_new_boards));
      v_metadata := jsonb_build_object('boardsBefore', v_old_boards, 'boardsAfter', v_new_boards);
      perform jword.write_boards(p_owner_id, v_watch.id, v_new_boards);
    end if;
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
  set version = version + 1
  where user_id = p_owner_id and id = v_watch.id
  returning version into v_version;

  v_summary := format('Updated watch for %s', v_company.name);
  v_activity_id := jword.add_watch_activity(
    p_owner_id, v_watch.id, 'WATCH_UPDATED', v_actor, v_summary,
    jsonb_build_object('fields', v_changed, 'before', v_before, 'after', v_after) || v_metadata
  );

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'watchId', v_watch.id, 'companyId', v_company.id, 'company', v_company.name,
    'active', v_watch.active, 'version', v_version, 'activityId', v_activity_id,
    'summary', v_summary, 'changedFields', v_changed, 'before', v_before, 'after', v_after
  ));
end;
$$;

revoke all on function jword.validate_watch_command(text, jsonb) from public, anon, authenticated;
revoke all on function jword.assert_board_free(uuid, public.ats_provider, text, uuid) from public, anon, authenticated;
revoke all on function jword.normalize_boards(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function jword.current_boards(uuid, uuid) from public, anon, authenticated;
revoke all on function jword.write_boards(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function jword.boards_label(jsonb) from public, anon, authenticated;
revoke all on function jword.create_company_watch(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function jword.update_company_watch(uuid, text, uuid, jsonb) from public, anon, authenticated;
