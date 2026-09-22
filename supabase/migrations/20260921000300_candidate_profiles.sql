-- Minimal candidate profile (one row per user). Added at the owner's request for this MVP;
-- it exists for future autofill compatibility and has only a small settings form.

create table public.candidate_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  location text,
  linkedin_url text,
  github_url text,
  portfolio_url text,
  school text,
  degree text,
  graduation_date date,
  work_authorization text,
  requires_sponsorship boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger candidate_profiles_set_updated_at
  before update on public.candidate_profiles
  for each row execute function jword.set_updated_at();

alter table public.candidate_profiles enable row level security;
create policy candidate_profiles_owner_select on public.candidate_profiles
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.candidate_profiles from anon, authenticated;
grant select on public.candidate_profiles to authenticated;
grant select, insert, update, delete on public.candidate_profiles to service_role;

-- Upsert through a function so the web role never needs direct table writes.
create or replace function public.save_candidate_profile(p_owner_id uuid, p_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := jword.resolve_owner(p_owner_id);
  v_allowed text[] := array[
    'fullName','email','phone','location','linkedinUrl','githubUrl','portfolioUrl',
    'school','degree','graduationDate','workAuthorization','requiresSponsorship'
  ];
  v_key text;
  v_row public.candidate_profiles%rowtype;
begin
  for v_key in select jsonb_object_keys(p_command) loop
    if not (v_key = any (v_allowed)) then
      perform jword.fail('JW422', format('Field "%s" cannot be edited.', v_key), 'FIELD_NOT_ALLOWED');
    end if;
  end loop;

  insert into public.candidate_profiles as cp (
    user_id, full_name, email, phone, location, linkedin_url, github_url, portfolio_url,
    school, degree, graduation_date, work_authorization, requires_sponsorship
  ) values (
    v_owner,
    jword.clean_text(p_command->>'fullName'), jword.clean_text(p_command->>'email'),
    jword.clean_text(p_command->>'phone'), jword.clean_text(p_command->>'location'),
    jword.clean_text(p_command->>'linkedinUrl'), jword.clean_text(p_command->>'githubUrl'),
    jword.clean_text(p_command->>'portfolioUrl'), jword.clean_text(p_command->>'school'),
    jword.clean_text(p_command->>'degree'), jword.parse_date(p_command->>'graduationDate', 'graduationDate'),
    jword.clean_text(p_command->>'workAuthorization'), (p_command->>'requiresSponsorship')::boolean
  )
  on conflict (user_id) do update set
    full_name = excluded.full_name, email = excluded.email, phone = excluded.phone,
    location = excluded.location, linkedin_url = excluded.linkedin_url, github_url = excluded.github_url,
    portfolio_url = excluded.portfolio_url, school = excluded.school, degree = excluded.degree,
    graduation_date = excluded.graduation_date, work_authorization = excluded.work_authorization,
    requires_sponsorship = excluded.requires_sponsorship
  returning * into v_row;

  return jsonb_build_object(
    'ok', true, 'operation', 'save_candidate_profile', 'userId', v_row.user_id, 'updatedAt', v_row.updated_at
  );
end;
$$;

revoke execute on function public.save_candidate_profile(uuid, jsonb) from public, anon;
grant execute on function public.save_candidate_profile(uuid, jsonb) to authenticated, service_role;
