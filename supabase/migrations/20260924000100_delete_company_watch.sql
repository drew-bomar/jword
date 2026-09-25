-- Decision 021: explicit watch deletion, preserving companies, applications, and audit history.
alter type public.watch_event_type add value 'WATCH_DELETED';

-- Keep an immutable historical identity and a nullable live reference. Deleting the watch
-- clears only its live reference; owner scoping and the audit rows survive.
alter table public.company_watch_activities add column original_watch_id uuid;
update public.company_watch_activities set original_watch_id = watch_id;
alter table public.company_watch_activities
  alter column original_watch_id set not null,
  alter column watch_id drop not null,
  drop constraint company_watch_activities_watch_owner_fkey,
  add constraint company_watch_activities_watch_owner_fkey foreign key (user_id, watch_id)
    references public.company_watches (user_id, id) on delete set null (watch_id),
  add constraint company_watch_activities_identity_check
    check (watch_id is null or watch_id = original_watch_id);
create index company_watch_activities_original_watch_idx
  on public.company_watch_activities (user_id, original_watch_id, occurred_at desc);

-- All existing mutation functions keep working. New audit rows must start with a live,
-- owner-matched watch (the composite FK verifies ownership).
create function jword.set_watch_activity_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.watch_id is null then
    perform jword.fail('JW422', 'A new watch activity must reference a watch.', 'WATCH_REQUIRED');
  end if;
  new.original_watch_id := new.watch_id;
  return new;
end;
$$;
create trigger company_watch_activities_set_identity
  before insert on public.company_watch_activities
  for each row execute function jword.set_watch_activity_identity();
revoke all on function jword.set_watch_activity_identity() from public, anon, authenticated;

create function jword.delete_company_watch(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'delete_company_watch';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_replay jsonb;
  v_watch public.company_watches%rowtype;
  v_company public.companies%rowtype;
  v_boards jsonb;
  v_summary text;
  v_activity_id uuid;
  v_before jsonb;
  v_after jsonb := '{"active":false,"deleted":true}'::jsonb;
begin
  v_replay := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_replay is not null then return v_replay; end if;

  -- Same lock order as create/update, including concurrent re-add of this company.
  select c.* into v_company
  from public.companies c join public.company_watches w
    on w.company_id = c.id and w.user_id = c.user_id
  where w.user_id = p_owner_id and w.id = (p_command->>'watchId')::uuid
  for update of c;
  v_watch := jword.lock_watch(p_owner_id, (p_command->>'watchId')::uuid,
    (p_command->>'expectedVersion')::integer);
  v_boards := jword.current_boards(p_owner_id, v_watch.id);
  v_before := jsonb_build_object('active', v_watch.active, 'deleted', false);
  v_summary := format('Deleted watch for %s', v_company.name);
  v_activity_id := jword.add_watch_activity(p_owner_id, v_watch.id, 'WATCH_DELETED', v_actor,
    v_summary, jsonb_build_object('fields', '["deleted"]'::jsonb,
      'companyId', v_company.id, 'boardsBefore', v_boards, 'before', v_before, 'after', v_after));

  -- Boards cascade away. Activities retain their original_watch_id and lose only watch_id.
  delete from public.company_watches where user_id = p_owner_id and id = v_watch.id;

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'watchId', v_watch.id, 'companyId', v_company.id, 'company', v_company.name,
    'deleted', true, 'active', false, 'version', v_watch.version + 1,
    'activityId', v_activity_id, 'summary', v_summary, 'changedFields', '["deleted"]'::jsonb,
    'before', v_before, 'after', v_after
  ));
end;
$$;

create function public.delete_company_watch(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_object('{
    "watchId":{"type":"uuid","required":true},
    "expectedVersion":{"type":"integer","required":true,"min":1,"max":2147483647},
    "confirmed":{"type":"boolean","required":true}
  }'::jsonb, p_command);
begin
  if v_command->'confirmed' <> 'true'::jsonb then
    perform jword.fail('JW422', 'Confirm deleting this watch.', 'CONFIRMATION_REQUIRED');
  end if;
  return jword.delete_company_watch(v_owner, p_actor, p_request_id, v_command);
end;
$$;
revoke all on function jword.delete_company_watch(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.delete_company_watch(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.delete_company_watch(uuid, text, uuid, jsonb) to authenticated, service_role;
