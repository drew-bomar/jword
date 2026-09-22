-- jword v1 schema: enums, tracker tables, view, RLS, and grants.
-- Writes happen only through the approved functions in 20260921000200_mutation_functions.sql.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Private schema for privileged implementation helpers (never exposed over the API).
-- ---------------------------------------------------------------------------
create schema if not exists jword;
revoke all on schema jword from public, anon, authenticated;
grant usage on schema jword to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.application_status as enum (
  'SAVED', 'RESEARCHING', 'READY_TO_APPLY', 'APPLIED', 'OA',
  'INTERVIEW', 'FINAL', 'OFFER', 'REJECTED', 'WITHDRAWN'
);
create type public.application_priority as enum ('LOW', 'MEDIUM', 'HIGH');
create type public.work_arrangement as enum ('UNKNOWN', 'REMOTE', 'HYBRID', 'ONSITE');
create type public.activity_type as enum (
  'CREATED', 'STATUS_CHANGED', 'DETAILS_UPDATED', 'NOTE_ADDED', 'NOTE_UPDATED', 'IMPORTED'
);
create type public.actor_type as enum ('USER', 'CODEX', 'IMPORT', 'SYSTEM');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current on every row update.
-- ---------------------------------------------------------------------------
create or replace function jword.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- companies
-- ---------------------------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  normalized_name text not null,
  website_url text,
  target_company boolean not null default false,
  interest_level smallint check (interest_level between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_nonblank check (btrim(name) <> ''),
  constraint companies_normalized_name_nonblank check (btrim(normalized_name) <> ''),
  constraint companies_user_normalized_name_key unique (user_id, normalized_name),
  constraint companies_user_id_id_key unique (user_id, id)
);
create index companies_user_name_idx on public.companies (user_id, name);
create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null,
  title text not null,
  normalized_title text not null,
  job_url text,
  external_job_id text,
  location text,
  work_arrangement public.work_arrangement not null default 'UNKNOWN',
  description text,
  date_posted date,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_title_nonblank check (btrim(title) <> ''),
  constraint jobs_user_id_id_key unique (user_id, id),
  -- Composite FK: a job can only reference a company owned by the same user.
  constraint jobs_company_owner_fkey foreign key (user_id, company_id)
    references public.companies (user_id, id) on delete restrict
);
create index jobs_user_company_idx on public.jobs (user_id, company_id);
create index jobs_user_normalized_title_idx on public.jobs (user_id, normalized_title);
create index jobs_user_job_url_idx on public.jobs (user_id, job_url) where job_url is not null;
create index jobs_user_company_external_id_idx
  on public.jobs (user_id, company_id, external_job_id) where external_job_id is not null;
create trigger jobs_set_updated_at
  before update on public.jobs
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- applications
-- ---------------------------------------------------------------------------
create table public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null,
  version integer not null default 1 check (version >= 1),
  status public.application_status not null default 'SAVED',
  priority public.application_priority not null default 'MEDIUM',
  date_found date,
  applied_at date,
  last_activity_at timestamptz not null default now(),
  resume_version text,
  referral text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint applications_user_job_key unique (user_id, job_id),
  constraint applications_user_id_id_key unique (user_id, id),
  constraint applications_job_owner_fkey foreign key (user_id, job_id)
    references public.jobs (user_id, id) on delete restrict
);
create index applications_user_status_idx on public.applications (user_id, status);
create index applications_user_priority_idx on public.applications (user_id, priority);
create index applications_user_last_activity_idx on public.applications (user_id, last_activity_at desc);
create trigger applications_set_updated_at
  before update on public.applications
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- application_notes (decision 012: one Notes section with editable dated notes)
-- ---------------------------------------------------------------------------
create table public.application_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null,
  body text not null,
  note_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_notes_body_nonblank check (btrim(body) <> ''),
  constraint application_notes_user_id_id_key unique (user_id, id),
  constraint application_notes_application_owner_fkey foreign key (user_id, application_id)
    references public.applications (user_id, id) on delete cascade
);
create index application_notes_order_idx
  on public.application_notes (user_id, application_id, created_at desc, id);
create trigger application_notes_set_updated_at
  before update on public.application_notes
  for each row execute function jword.set_updated_at();

-- ---------------------------------------------------------------------------
-- application_activities (append-only timeline)
-- ---------------------------------------------------------------------------
create table public.application_activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid not null,
  type public.activity_type not null,
  actor_type public.actor_type not null,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint application_activities_application_owner_fkey foreign key (user_id, application_id)
    references public.applications (user_id, id) on delete cascade
);
create index application_activities_app_idx
  on public.application_activities (user_id, application_id, occurred_at desc);
create index application_activities_user_idx
  on public.application_activities (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- mutation_requests (decision 009: retry receipts, internal only)
-- ---------------------------------------------------------------------------
create table public.mutation_requests (
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  operation text not null,
  input_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);

-- ---------------------------------------------------------------------------
-- Flattened read model for the tracker table and search.
-- security_invoker means the caller's RLS still applies to the underlying tables.
-- ---------------------------------------------------------------------------
create view public.application_overview
with (security_invoker = true) as
select
  a.id as application_id,
  a.user_id,
  a.job_id,
  j.company_id,
  c.name as company_name,
  c.normalized_name as company_normalized_name,
  j.title,
  j.normalized_title,
  j.job_url,
  j.external_job_id,
  j.location,
  j.work_arrangement,
  j.description,
  j.date_posted,
  j.source,
  a.status,
  a.priority,
  a.version,
  a.date_found,
  a.applied_at,
  a.last_activity_at,
  a.resume_version,
  a.referral,
  a.created_at,
  greatest(a.updated_at, j.updated_at) as updated_at
from public.applications a
join public.jobs j on j.id = a.job_id and j.user_id = a.user_id
join public.companies c on c.id = j.company_id and c.user_id = j.user_id;

-- ---------------------------------------------------------------------------
-- Row Level Security: owners may read their rows. Nobody may write directly.
-- ---------------------------------------------------------------------------
alter table public.companies enable row level security;
alter table public.jobs enable row level security;
alter table public.applications enable row level security;
alter table public.application_notes enable row level security;
alter table public.application_activities enable row level security;
alter table public.mutation_requests enable row level security;

create policy companies_owner_select on public.companies
  for select to authenticated using ((select auth.uid()) = user_id);
create policy jobs_owner_select on public.jobs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy applications_owner_select on public.applications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy application_notes_owner_select on public.application_notes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy application_activities_owner_select on public.application_activities
  for select to authenticated using ((select auth.uid()) = user_id);
-- mutation_requests intentionally has no policies: RLS enabled with no policy denies everything
-- for anon/authenticated. Receipts are read and written only inside the mutation functions.

-- Supabase grants all table privileges to anon/authenticated by default; take them back so
-- the only write path is the approved function set (decision 010).
revoke all on all tables in schema public from anon, authenticated;
grant select on public.companies, public.jobs, public.applications,
  public.application_notes, public.application_activities, public.application_overview
  to authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
