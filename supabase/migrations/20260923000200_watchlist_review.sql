-- JWO-16 review: consistent lock order, typed board conflicts, duplicate URL parity,
-- and stable IDs for boards retained by a configuration update. No new public API/grants.

alter table public.company_watch_boards
  drop constraint company_watch_boards_watch_position_key,
  add constraint company_watch_boards_watch_position_key unique (watch_id, position)
    deferrable initially immediate;

create or replace function jword.watch_board_key(p_provider public.ats_provider, p_identifier text, p_url text)
returns text language sql immutable set search_path = '' as $$
  select case when p_identifier is null then 'URL:' || lower(p_url)
    else p_provider::text || ':' || lower(p_identifier) end;
$$;
revoke all on function jword.watch_board_key(public.ats_provider, text, text) from public, anon, authenticated;

create or replace function jword.normalize_boards(p_owner_id uuid, p_boards jsonb, p_watch_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_provider public.ats_provider;
  v_identifier text;
  v_url text;
  v_seen text[] := '{}';
  v_urls text[] := '{}';
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
    if v_key = any (v_seen) or lower(v_url) = any (v_urls) then
      perform jword.fail('JW422', 'The same board is listed twice.', 'DUPLICATE_BOARD');
    end if;
    v_seen := v_seen || v_key;
    v_urls := v_urls || lower(v_url);
    perform jword.assert_board_free(p_owner_id, v_provider, v_identifier, p_watch_id);
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'provider', v_provider, 'boardIdentifier', v_identifier, 'boardUrl', v_url
    ));
  end loop;
  return v_result;
end;
$$;

-- Reconcile the complete desired set. Surviving boards keep IDs and created_at, even on reorder.
create or replace function jword.write_boards(p_owner_id uuid, p_watch_id uuid, p_boards jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  set constraints public.company_watch_boards_watch_position_key deferred;
  delete from public.company_watch_boards b
  where b.user_id = p_owner_id and b.watch_id = p_watch_id
    and not exists (
      select 1 from jsonb_array_elements(p_boards) x
      where jword.watch_board_key(b.provider, b.board_identifier, b.board_url) =
        jword.watch_board_key((x->>'provider')::public.ats_provider, x->>'boardIdentifier', x->>'boardUrl')
    );
  update public.company_watch_boards b
  set position = x.ordinality::smallint,
      board_identifier = x.value->>'boardIdentifier', board_url = x.value->>'boardUrl'
  from jsonb_array_elements(p_boards) with ordinality x
  where b.user_id = p_owner_id and b.watch_id = p_watch_id
    and jword.watch_board_key(b.provider, b.board_identifier, b.board_url) =
      jword.watch_board_key((x.value->>'provider')::public.ats_provider, x.value->>'boardIdentifier', x.value->>'boardUrl');
  insert into public.company_watch_boards (user_id, watch_id, position, provider, board_identifier, board_url)
  select p_owner_id, p_watch_id, x.ordinality::smallint,
    (x.value->>'provider')::public.ats_provider, x.value->>'boardIdentifier', x.value->>'boardUrl'
  from jsonb_array_elements(p_boards) with ordinality x
  where not exists (
    select 1 from public.company_watch_boards b
    where b.user_id = p_owner_id and b.watch_id = p_watch_id
      and jword.watch_board_key(b.provider, b.board_identifier, b.board_url) =
        jword.watch_board_key((x.value->>'provider')::public.ats_provider, x.value->>'boardIdentifier', x.value->>'boardUrl')
  );
  set constraints public.company_watch_boards_watch_position_key immediate;
end;
$$;

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
    perform jword.normalize_boards(p_owner_id, p_command->'boards', null);
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

  -- Same order as create: company, then watch. The company link is immutable.
  select c.* into v_company from public.companies c
  join public.company_watches w on w.company_id = c.id and w.user_id = c.user_id
  where w.user_id = p_owner_id and w.id = (p_command->>'watchId')::uuid
  for update of c;
  v_watch := jword.lock_watch(p_owner_id, (p_command->>'watchId')::uuid, (p_command->>'expectedVersion')::integer);

  if p_command ? 'boards' then
    v_old_boards := jword.current_boards(p_owner_id, v_watch.id);
    v_new_boards := jword.normalize_boards(p_owner_id, p_command->'boards', v_watch.id);
    if v_new_boards <> v_old_boards then
      v_changed := v_changed || '"boards"'::jsonb;
      v_before := v_before || jsonb_build_object('boards', jword.boards_label(v_old_boards));
      v_after := v_after || jsonb_build_object('boards', jword.boards_label(v_new_boards));
      v_metadata := jsonb_build_object('boardsBefore', v_old_boards, 'boardsAfter', v_new_boards);
      begin
        perform jword.write_boards(p_owner_id, v_watch.id, v_new_boards);
      exception when unique_violation then
        -- A different watch can claim a board after our initial check. Recheck raw input.
        perform jword.normalize_boards(p_owner_id, p_command->'boards', v_watch.id);
        raise;
      end;
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
