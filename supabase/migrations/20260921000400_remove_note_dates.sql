-- Remove optional note date labels (owner decision 015, 2026-09-21): every note and activity already
-- carries real timestamps, so the extra editable label was redundant. Notes keep body + timestamps.

alter table public.application_notes drop column if exists note_date;

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
  v_note_id uuid;
  v_activity_id uuid;
  v_result jsonb;
  v_key text;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  for v_key in select jsonb_object_keys(p_command) loop
    if v_key not in ('applicationId', 'expectedVersion', 'note') then
      perform jword.fail('JW422', format('Field "%s" is not accepted.', v_key), 'FIELD_NOT_ALLOWED');
    end if;
  end loop;

  v_app := jword.lock_application(v_owner, (p_command->>'applicationId')::uuid, (p_command->>'expectedVersion')::integer);
  if v_body is null or btrim(v_body) = '' then
    perform jword.fail('JW422', 'Note text is required.', 'NOTE_REQUIRED');
  end if;

  insert into public.application_notes (user_id, application_id, body)
  values (v_owner, v_app.id, v_body)
  returning id into v_note_id;

  update public.applications
  set version = version + 1, last_activity_at = now()
  where id = v_app.id and user_id = v_owner;

  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata)
  values (v_owner, v_app.id, 'NOTE_ADDED', v_actor, 'Added a note', jsonb_build_object('noteId', v_note_id))
  returning id into v_activity_id;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'noteId', v_note_id, 'version', v_app.version + 1, 'activityId', v_activity_id,
    'summary', 'Note added',
    'changedFields', jsonb_build_array('note'), 'before', '{}'::jsonb, 'after', '{}'::jsonb
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
  v_activity_id uuid;
  v_result jsonb;
  v_key text;
begin
  v_existing := jword.begin_request(v_owner, p_request_id, v_op, v_fp);
  if v_existing is not null then
    return v_existing;
  end if;

  for v_key in select jsonb_object_keys(p_command) loop
    if v_key not in ('applicationId', 'expectedVersion', 'noteId', 'note') then
      perform jword.fail('JW422', format('Field "%s" is not accepted.', v_key), 'FIELD_NOT_ALLOWED');
    end if;
  end loop;

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

  v_body := p_command->>'note';
  if v_body is null or btrim(v_body) = '' then
    perform jword.fail('JW422', 'Note text cannot be blank.', 'NOTE_REQUIRED');
  end if;

  if v_body = v_note.body then
    v_result := jsonb_build_object(
      'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', true,
      'applicationId', v_app.id, 'noteId', v_note.id, 'version', v_app.version,
      'summary', 'Note is already up to date.',
      'changedFields', '[]'::jsonb, 'before', '{}'::jsonb, 'after', '{}'::jsonb
    );
    return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
  end if;

  update public.application_notes set body = v_body where id = v_note.id and user_id = v_owner;

  update public.applications
  set version = version + 1, last_activity_at = now()
  where id = v_app.id and user_id = v_owner;

  -- Note text before/after stays in owner-protected history only; results expose field names.
  insert into public.application_activities (user_id, application_id, type, actor_type, summary, metadata)
  values (
    v_owner, v_app.id, 'NOTE_UPDATED', v_actor, 'Updated a note',
    jsonb_build_object('noteId', v_note.id, 'fields', jsonb_build_array('note'),
      'before', jsonb_build_object('note', v_note.body), 'after', jsonb_build_object('note', v_body))
  ) returning id into v_activity_id;

  v_result := jsonb_build_object(
    'ok', true, 'operation', v_op, 'requestId', p_request_id, 'noop', false,
    'applicationId', v_app.id, 'noteId', v_note.id, 'version', v_app.version + 1, 'activityId', v_activity_id,
    'summary', 'Note updated',
    'changedFields', jsonb_build_array('note'), 'before', '{}'::jsonb, 'after', '{}'::jsonb
  );
  return jword.finish_request(v_owner, p_request_id, v_op, v_fp, v_result);
end;
$$;
