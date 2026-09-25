-- Decision 022: provider-specific board identifiers. One function derives the canonical board
-- URL, or null for an identifier that is invalid for its provider. The table check, the
-- write path, and packages/core/src/watchlist/boards.ts all follow the same rules:
--   GREENHOUSE / LEVER / ASHBY: {name}, ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$
--   WORKDAY: {account}/{cluster}/{site} -> https://{account}.{cluster}.myworkdayjobs.com/{site}
-- Workday's account and cluster become a hostname, so they are a lowercase DNS label and
-- wd<digits>; the site keeps its case. Uniqueness still uses lower(board_identifier).

create or replace function jword.canonical_board_url(p_provider public.ats_provider, p_identifier text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_identifier is null then null
    when p_provider in ('GREENHOUSE', 'LEVER', 'ASHBY')
      and p_identifier ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' then
      case p_provider
        when 'GREENHOUSE' then 'https://job-boards.greenhouse.io/'
        when 'LEVER' then 'https://jobs.lever.co/'
        else 'https://jobs.ashbyhq.com/'
      end || p_identifier
    when p_provider = 'WORKDAY'
      and p_identifier ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?/wd[0-9]{1,3}/[A-Za-z0-9][A-Za-z0-9_-]{0,99}$' then
      'https://' || split_part(p_identifier, '/', 1) || '.' || split_part(p_identifier, '/', 2)
        || '.myworkdayjobs.com/' || split_part(p_identifier, '/', 3)
  end;
$$;
revoke all on function jword.canonical_board_url(public.ats_provider, text) from public, anon, authenticated;

alter table public.company_watch_boards
  drop constraint company_watch_boards_shape,
  add constraint company_watch_boards_shape check (
    (provider = 'OTHER' and board_identifier is null)
    or (
      provider <> 'OTHER'
      and jword.canonical_board_url(provider, board_identifier) is not null
      and board_url = jword.canonical_board_url(provider, board_identifier)
    )
  );

create or replace function jword.provider_label(p_provider public.ats_provider)
returns text language sql immutable set search_path = '' as $$
  select case p_provider
    when 'GREENHOUSE' then 'Greenhouse'
    when 'LEVER' then 'Lever'
    when 'ASHBY' then 'Ashby'
    when 'WORKDAY' then 'Workday'
    else 'no supported job board'
  end;
$$;

-- Returns the board URL to store: derived for supported providers, the optional careers URL
-- for OTHER.
create or replace function jword.resolve_board_url(
  p_provider public.ats_provider, p_identifier text, p_other_url text
)
returns text language plpgsql set search_path = '' as $$
declare
  v_url text;
begin
  if p_provider = 'OTHER' then
    if p_identifier is not null then
      perform jword.fail('JW422', 'A board identifier applies only to Greenhouse, Lever, Ashby, or Workday.', 'BOARD_IDENTIFIER_NOT_ALLOWED');
    end if;
    return p_other_url;
  end if;
  if p_identifier is null then
    perform jword.fail('JW422', format('%s needs a board identifier.', jword.provider_label(p_provider)), 'BOARD_IDENTIFIER_REQUIRED');
  end if;
  v_url := jword.canonical_board_url(p_provider, p_identifier);
  if v_url is null then
    perform jword.fail('JW422', 'Board identifier has an invalid format.', 'BOARD_IDENTIFIER_INVALID');
  end if;
  if p_other_url is not null then
    perform jword.fail('JW422', 'The board URL is set from the provider and identifier.', 'BOARD_URL_DERIVED');
  end if;
  return v_url;
end;
$$;

-- Command shape only (the same as before plus WORKDAY and room for account/cluster/site);
-- resolve_board_url() applies the exact per-provider rule.
create or replace function jword.validate_watch_command(p_operation text, p_command jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_company constant jsonb := $c${
    "interestLevel": {"type": "integer", "min": 1, "max": 5, "nullable": true},
    "websiteUrl": {"type": "url", "max": 2048, "nullable": true},
    "companyNotes": {"type": "text", "max": 5000, "nullable": true}
  }$c$::jsonb;
  v_board constant jsonb := $b${
    "provider": {"type": "enum", "values": ["GREENHOUSE", "LEVER", "ASHBY", "WORKDAY", "OTHER"], "required": true},
    "boardIdentifier": {"type": "text", "max": 170, "nullable": true, "pattern": "^[A-Za-z0-9][A-Za-z0-9._/-]*$"},
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
