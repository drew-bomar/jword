-- Decision 025: confirmed application deletion (owner request, 2026-09-25, for testing and
-- cleanup). Deletes the application, its job row, notes, and activity history; keeps the company.
-- A lead that became this application returns to NEW with an audit row. The retry receipt keeps
-- the result, so a lost response can be retried with the same request id.

create function jword.delete_application(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_actor public.actor_type := jword.parse_actor(p_actor);
  v_op constant text := 'delete_application';
  v_fp text := jword.fingerprint(v_op, p_actor, p_command);
  v_existing jsonb;
  v_app public.applications%rowtype;
  v_job public.jobs%rowtype;
  v_company public.companies%rowtype;
  v_lead public.leads%rowtype;
  v_leads jsonb := '[]'::jsonb;
  v_summary text;
begin
  -- A replay is answered before looking for the application, which no longer exists.
  v_existing := jword.begin_request(p_owner_id, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;
  v_app := jword.lock_application(p_owner_id, (p_command->>'applicationId')::uuid,
    (p_command->>'expectedVersion')::integer);
  select * into v_job from public.jobs where user_id = p_owner_id and id = v_app.job_id for update;
  select * into v_company from public.companies where user_id = p_owner_id and id = v_job.company_id;
  v_summary := format('Deleted application for %s at %s', v_job.title, v_company.name);

  for v_lead in
    select * from public.leads
    where user_id = p_owner_id and application_id = v_app.id
    for update
  loop
    update public.leads
    set review_status = 'NEW', application_id = null, reviewed_at = now(), version = version + 1
    where id = v_lead.id;
    perform jword.add_lead_activity(p_owner_id, v_lead.id, 'LEAD_RESTORED', v_actor,
      format('Returned %s to New: its application was deleted', v_lead.title),
      jsonb_build_object('before', 'PROMOTED', 'after', 'NEW', 'deletedApplicationId', v_app.id));
    v_leads := v_leads || to_jsonb(v_lead.id);
  end loop;

  -- Notes and activity history cascade with the application; the job row goes next.
  delete from public.applications where user_id = p_owner_id and id = v_app.id;
  delete from public.jobs j
  where j.user_id = p_owner_id and j.id = v_job.id
    and not exists (select 1 from public.applications a where a.user_id = p_owner_id and a.job_id = j.id);

  return jword.finish_request(p_owner_id, p_request_id, v_op, v_fp, jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'companyId', v_company.id, 'version', v_app.version,
    'deleted', true, 'restoredLeadIds', v_leads, 'activityId', null,
    'summary', v_summary, 'changedFields', '["deleted"]'::jsonb,
    'before', jsonb_build_object('status', v_app.status::text), 'after', '{}'::jsonb
  ));
end;
$$;

create function public.delete_application(
  p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_object('{
    "applicationId":{"type":"uuid","required":true},
    "expectedVersion":{"type":"integer","required":true,"min":1,"max":2147483647},
    "confirmed":{"type":"boolean","required":true}
  }'::jsonb, p_command);
begin
  if v_command->'confirmed' <> 'true'::jsonb then
    perform jword.fail('JW422', 'Confirm deleting this application.', 'CONFIRMATION_REQUIRED');
  end if;
  return jword.delete_application(v_owner, p_actor, p_request_id, v_command);
end;
$$;

revoke all on function jword.delete_application(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.delete_application(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.delete_application(uuid, text, uuid, jsonb) to authenticated, service_role;
