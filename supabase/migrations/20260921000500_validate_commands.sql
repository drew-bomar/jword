-- Close direct-RPC validation gaps without rewriting historical migrations.
-- TypeScript owns boundary validation and interactive policy; the database repeats
-- write invariants because authenticated clients may call RPCs directly.
create or replace function jword.validate_command(p_operation text, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_specs constant jsonb := $specs${
  "create_application": {
    "company": {
      "type": "text",
      "max": 200,
      "required": true
    },
    "companyId": {
      "type": "uuid"
    },
    "title": {
      "type": "text",
      "max": 200,
      "required": true
    },
    "status": {
      "type": "enum",
      "values": [
        "SAVED",
        "RESEARCHING",
        "READY_TO_APPLY",
        "APPLIED",
        "OA",
        "INTERVIEW",
        "FINAL",
        "OFFER",
        "REJECTED",
        "WITHDRAWN"
      ]
    },
    "priority": {
      "type": "enum",
      "values": [
        "LOW",
        "MEDIUM",
        "HIGH"
      ]
    },
    "jobUrl": {
      "type": "url",
      "max": 2048,
      "nullable": true
    },
    "externalJobId": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "location": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "workArrangement": {
      "type": "enum",
      "values": [
        "UNKNOWN",
        "REMOTE",
        "HYBRID",
        "ONSITE"
      ]
    },
    "description": {
      "type": "text",
      "max": 10000,
      "nullable": true
    },
    "datePosted": {
      "type": "date",
      "nullable": true
    },
    "dateFound": {
      "type": "date",
      "nullable": true
    },
    "appliedAt": {
      "type": "date",
      "nullable": true
    },
    "source": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "resumeVersion": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "referral": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "initialNote": {
      "type": "text",
      "max": 5000,
      "nullable": true
    },
    "allowDuplicate": {
      "type": "boolean"
    }
  },
  "update_application_status": {
    "applicationId": {
      "type": "uuid",
      "required": true
    },
    "expectedVersion": {
      "type": "integer",
      "required": true,
      "min": 1,
      "max": 2147483647
    },
    "status": {
      "type": "enum",
      "values": [
        "SAVED",
        "RESEARCHING",
        "READY_TO_APPLY",
        "APPLIED",
        "OA",
        "INTERVIEW",
        "FINAL",
        "OFFER",
        "REJECTED",
        "WITHDRAWN"
      ],
      "required": true
    },
    "appliedAt": {
      "type": "date",
      "nullable": true
    },
    "occurredAt": {
      "type": "timestamp"
    }
  },
  "update_application_details": {
    "applicationId": {
      "type": "uuid",
      "required": true
    },
    "expectedVersion": {
      "type": "integer",
      "required": true,
      "min": 1,
      "max": 2147483647
    },
    "company": {
      "type": "text",
      "max": 200
    },
    "companyId": {
      "type": "uuid"
    },
    "title": {
      "type": "text",
      "max": 200
    },
    "priority": {
      "type": "enum",
      "values": [
        "LOW",
        "MEDIUM",
        "HIGH"
      ]
    },
    "jobUrl": {
      "type": "url",
      "max": 2048,
      "nullable": true
    },
    "externalJobId": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "location": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "workArrangement": {
      "type": "enum",
      "values": [
        "UNKNOWN",
        "REMOTE",
        "HYBRID",
        "ONSITE"
      ]
    },
    "description": {
      "type": "text",
      "max": 10000,
      "nullable": true
    },
    "datePosted": {
      "type": "date",
      "nullable": true
    },
    "dateFound": {
      "type": "date",
      "nullable": true
    },
    "appliedAt": {
      "type": "date",
      "nullable": true
    },
    "source": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "resumeVersion": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "referral": {
      "type": "text",
      "max": 200,
      "nullable": true
    }
  },
  "add_application_note": {
    "applicationId": {
      "type": "uuid",
      "required": true
    },
    "expectedVersion": {
      "type": "integer",
      "required": true,
      "min": 1,
      "max": 2147483647
    },
    "note": {
      "type": "text",
      "max": 5000,
      "required": true
    }
  },
  "update_application_note": {
    "applicationId": {
      "type": "uuid",
      "required": true
    },
    "expectedVersion": {
      "type": "integer",
      "required": true,
      "min": 1,
      "max": 2147483647
    },
    "noteId": {
      "type": "uuid",
      "required": true
    },
    "note": {
      "type": "text",
      "max": 10000,
      "required": true
    }
  },
  "import_row": {
    "company": {
      "type": "text",
      "max": 200,
      "required": true
    },
    "title": {
      "type": "text",
      "max": 200,
      "required": true
    },
    "status": {
      "type": "enum",
      "values": [
        "SAVED",
        "RESEARCHING",
        "READY_TO_APPLY",
        "APPLIED",
        "OA",
        "INTERVIEW",
        "FINAL",
        "OFFER",
        "REJECTED",
        "WITHDRAWN"
      ]
    },
    "priority": {
      "type": "enum",
      "values": [
        "LOW",
        "MEDIUM",
        "HIGH"
      ]
    },
    "jobUrl": {
      "type": "url",
      "max": 2048,
      "nullable": true
    },
    "externalJobId": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "location": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "workArrangement": {
      "type": "enum",
      "values": [
        "UNKNOWN",
        "REMOTE",
        "HYBRID",
        "ONSITE"
      ]
    },
    "datePosted": {
      "type": "date",
      "nullable": true
    },
    "dateFound": {
      "type": "date",
      "nullable": true
    },
    "appliedAt": {
      "type": "date",
      "nullable": true
    },
    "source": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "resumeVersion": {
      "type": "text",
      "max": 100,
      "nullable": true
    },
    "referral": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "rowIndex": {
      "type": "integer",
      "required": true,
      "min": 1,
      "max": 2147483647
    },
    "note": {
      "type": "text",
      "max": 10000,
      "nullable": true
    },
    "duplicateChoice": {
      "type": "enum",
      "values": [
        "import_separate"
      ]
    }
  },
  "save_candidate_profile": {
    "fullName": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "phone": {
      "type": "text",
      "max": 50,
      "nullable": true
    },
    "location": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "school": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "degree": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "workAuthorization": {
      "type": "text",
      "max": 200,
      "nullable": true
    },
    "email": {
      "type": "email",
      "max": 320,
      "nullable": true
    },
    "linkedinUrl": {
      "type": "url",
      "max": 2048,
      "nullable": true
    },
    "githubUrl": {
      "type": "url",
      "max": 2048,
      "nullable": true
    },
    "portfolioUrl": {
      "type": "url",
      "max": 2048,
      "nullable": true
    },
    "graduationDate": {
      "type": "date",
      "nullable": true
    },
    "requiresSponsorship": {
      "type": "boolean",
      "nullable": true
    }
  }
}$specs$::jsonb;
  v_spec jsonb; v_rule jsonb; v_key text; v_value jsonb; v_text text;
  v_result jsonb := '{}'::jsonb; v_rows jsonb := '[]'::jsonb;
begin
  if p_command is null or jsonb_typeof(p_command) <> 'object' then
    perform jword.fail('JW422', 'Command must be an object.', 'INVALID_COMMAND');
  end if;
  if p_operation = 'import_applications' then
    if p_command - 'rows' <> '{}'::jsonb or not (p_command ? 'rows') or jsonb_typeof(p_command->'rows') <> 'array' then
      perform jword.fail('JW422', 'Supply only a rows array.', 'INVALID_COMMAND');
    end if;
    if jsonb_array_length(p_command->'rows') not between 1 and 500 then
      perform jword.fail('JW422', 'Select between 1 and 500 rows.', 'ROWS_LIMIT');
    end if;
    for v_value in select value from jsonb_array_elements(p_command->'rows') loop
      v_rows := v_rows || jsonb_build_array(jword.validate_command('import_row', v_value));
    end loop;
    return jsonb_build_object('rows', v_rows);
  end if;
  v_spec := v_specs->p_operation;
  if v_spec is null then perform jword.fail('JW422', 'Unknown operation.', 'INVALID_OPERATION'); end if;
  for v_key in select jsonb_object_keys(p_command) loop
    if not (v_spec ? v_key) then perform jword.fail('JW422', 'Unknown command field.', 'FIELD_NOT_ALLOWED'); end if;
  end loop;
  for v_key, v_rule in select key, value from jsonb_each(v_spec) loop
    if not (p_command ? v_key) then
      if coalesce((v_rule->>'required')::boolean, false) then
        perform jword.fail('JW422', format('%s is required.', v_key), 'REQUIRED_FIELD');
      end if;
      continue;
    end if;
    v_value := p_command->v_key;
    if jsonb_typeof(v_value) = 'string' then
      v_text := regexp_replace(p_command->>v_key, '^\s+|\s+$', '', 'g');
      if v_rule->>'type' in ('text','url','date') then v_value := to_jsonb(v_text); end if;
      if v_text = '' and coalesce((v_rule->>'nullable')::boolean, false) and v_rule->>'type' in ('text','url','email','date') then v_value := 'null'::jsonb; end if;
    end if;
    if v_value = 'null'::jsonb then
      if not coalesce((v_rule->>'nullable')::boolean, false) then
        perform jword.fail('JW422', format('%s cannot be null.', v_key), 'INVALID_FIELD');
      end if;
    elsif v_rule->>'type' = 'boolean' then
      if jsonb_typeof(v_value) <> 'boolean' then perform jword.fail('JW422', format('%s must be a boolean.', v_key), 'INVALID_FIELD'); end if;
    elsif v_rule->>'type' = 'integer' then
      if jsonb_typeof(v_value) <> 'number' then perform jword.fail('JW422', format('%s must be an integer.', v_key), 'INVALID_FIELD'); end if;
      if (v_value::text)::numeric <> trunc((v_value::text)::numeric) or (v_value::text)::numeric not between (v_rule->>'min')::numeric and (v_rule->>'max')::numeric then
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
        when 'url' then
          if v_text !~* '^https?://[^[:space:]]+$' then perform jword.fail('JW422', format('%s must be an HTTP or HTTPS URL.', v_key), 'INVALID_FIELD'); end if;
        when 'email' then
          if v_text !~ '^[A-Za-z0-9_+''.-]*[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$' or v_text ~ '^\.|\.\.' then
            perform jword.fail('JW422', 'Enter a valid email.', 'INVALID_FIELD');
          end if;
        when 'uuid' then
          if v_text not in ('00000000-0000-0000-0000-000000000000', 'ffffffff-ffff-ffff-ffff-ffffffffffff') and v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then perform jword.fail('JW422', format('%s must be a UUID.', v_key), 'INVALID_FIELD'); end if;
        when 'enum' then
          if not (v_rule->'values' ? v_text) then perform jword.fail('JW422', format('%s has an unknown value.', v_key), 'INVALID_FIELD'); end if;
        when 'date' then perform jword.parse_date(v_text, v_key);
        when 'timestamp' then
          if v_text !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then perform jword.fail('JW422', 'occurredAt must be an ISO timestamp with an offset.', 'INVALID_FIELD'); end if;
          perform jword.parse_timestamp(v_text, v_key);
      end case;
    end if;
    v_result := v_result || jsonb_build_object(v_key, v_value);
  end loop;
  if p_operation = 'update_application_details' and v_result - 'applicationId' - 'expectedVersion' = '{}'::jsonb then
    perform jword.fail('JW422', 'Supply at least one editable field.', 'EMPTY_UPDATE');
  end if;
  return v_result;
end;
$$;

alter function public.create_application(uuid, text, uuid, jsonb, date) set schema jword;
revoke all on function jword.create_application(uuid, text, uuid, jsonb, date) from public, anon, authenticated;
create function public.create_application(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('create_application', p_command);
begin
  return jword.create_application(v_owner, p_actor, p_request_id, v_command, p_today);
end;
$$;
revoke all on function public.create_application(uuid, text, uuid, jsonb, date) from public, anon;
grant execute on function public.create_application(uuid, text, uuid, jsonb, date) to authenticated, service_role;

alter function public.update_application_status(uuid, text, uuid, jsonb, date) set schema jword;
revoke all on function jword.update_application_status(uuid, text, uuid, jsonb, date) from public, anon, authenticated;
create function public.update_application_status(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('update_application_status', p_command);
begin
  return jword.update_application_status(v_owner, p_actor, p_request_id, v_command, p_today);
end;
$$;
revoke all on function public.update_application_status(uuid, text, uuid, jsonb, date) from public, anon;
grant execute on function public.update_application_status(uuid, text, uuid, jsonb, date) to authenticated, service_role;

alter function public.update_application_details(uuid, text, uuid, jsonb, date) set schema jword;
revoke all on function jword.update_application_details(uuid, text, uuid, jsonb, date) from public, anon, authenticated;
create function public.update_application_details(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('update_application_details', p_command);
begin
  return jword.update_application_details(v_owner, p_actor, p_request_id, v_command, p_today);
end;
$$;
revoke all on function public.update_application_details(uuid, text, uuid, jsonb, date) from public, anon;
grant execute on function public.update_application_details(uuid, text, uuid, jsonb, date) to authenticated, service_role;

alter function public.add_application_note(uuid, text, uuid, jsonb, date) set schema jword;
revoke all on function jword.add_application_note(uuid, text, uuid, jsonb, date) from public, anon, authenticated;
create function public.add_application_note(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('add_application_note', p_command);
begin
  return jword.add_application_note(v_owner, p_actor, p_request_id, v_command, p_today);
end;
$$;
revoke all on function public.add_application_note(uuid, text, uuid, jsonb, date) from public, anon;
grant execute on function public.add_application_note(uuid, text, uuid, jsonb, date) to authenticated, service_role;

alter function public.update_application_note(uuid, text, uuid, jsonb, date) set schema jword;
revoke all on function jword.update_application_note(uuid, text, uuid, jsonb, date) from public, anon, authenticated;
create function public.update_application_note(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb, p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('update_application_note', p_command);
begin
  return jword.update_application_note(v_owner, p_actor, p_request_id, v_command, p_today);
end;
$$;
revoke all on function public.update_application_note(uuid, text, uuid, jsonb, date) from public, anon;
grant execute on function public.update_application_note(uuid, text, uuid, jsonb, date) to authenticated, service_role;

alter function public.import_applications(uuid, text, uuid, jsonb) set schema jword;
revoke all on function jword.import_applications(uuid, text, uuid, jsonb) from public, anon, authenticated;
create function public.import_applications(p_owner_id uuid, p_actor text, p_request_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('import_applications', p_command);
begin
  return jword.import_applications(v_owner, p_actor, p_request_id, v_command);
end;
$$;
revoke all on function public.import_applications(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.import_applications(uuid, text, uuid, jsonb) to authenticated, service_role;

alter function public.save_candidate_profile(uuid, jsonb) set schema jword;
revoke all on function jword.save_candidate_profile(uuid, jsonb) from public, anon, authenticated;
create function public.save_candidate_profile(p_owner_id uuid, p_command jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_command jsonb := jword.validate_command('save_candidate_profile', p_command);
begin
  return jword.save_candidate_profile(v_owner, v_command);
end;
$$;
revoke all on function public.save_candidate_profile(uuid, jsonb) from public, anon;
grant execute on function public.save_candidate_profile(uuid, jsonb) to authenticated, service_role;

revoke all on function jword.validate_command(text, jsonb) from public, anon, authenticated;
