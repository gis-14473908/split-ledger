-- Multi-source AI: user-owned API key sources, free/granted quota, default source.

create table public.ai_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  label text not null,
  provider text not null,
  model text not null,
  api_key text not null,
  key_last4 text not null,
  created_at timestamptz not null default now()
);

create table public.ai_quota (
  owner_id uuid primary key references auth.users on delete cascade,
  used_micro bigint not null default 0,
  granted_micro bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.profiles add column default_source text;
update public.profiles set default_source = 'builtin:' || default_model where default_source is null;

alter table public.ai_sources enable row level security;
create policy ai_sources_select_own on public.ai_sources for select using (owner_id = auth.uid());
create policy ai_sources_insert_own on public.ai_sources for insert with check (owner_id = auth.uid());
create policy ai_sources_update_own on public.ai_sources for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy ai_sources_delete_own on public.ai_sources for delete using (owner_id = auth.uid());

-- Users may read their own quota; all writes go through the security-definer RPCs below.
alter table public.ai_quota enable row level security;
create policy ai_quota_select_own on public.ai_quota for select using (owner_id = auth.uid());

-- Free allowance is 1_000_000 micro; granted_micro extends it.
create function public.ai_quota_check() returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  if coalesce((select used_micro - granted_micro from ai_quota where owner_id = uid), 0) >= 1000000 then
    raise exception 'quota_exceeded';
  end if;
end $$;

create function public.ai_quota_add(p_micro bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  insert into ai_quota (owner_id, used_micro, updated_at)
  values (uid, greatest(p_micro, 0), now())
  on conflict (owner_id) do update
    set used_micro = ai_quota.used_micro + greatest(p_micro, 0), updated_at = now();
end $$;

-- Operator only (service_role): credit half of what a user paid.
create function public.admin_grant_quota(p_user uuid, p_paid_micro bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into ai_quota (owner_id, granted_micro, updated_at)
  values (p_user, floor(greatest(p_paid_micro, 0) * 0.5), now())
  on conflict (owner_id) do update
    set granted_micro = ai_quota.granted_micro + floor(greatest(p_paid_micro, 0) * 0.5), updated_at = now();
end $$;

revoke execute on function public.ai_quota_check() from public, anon;
revoke execute on function public.ai_quota_add(bigint) from public, anon;
revoke execute on function public.admin_grant_quota(uuid, bigint) from public, anon, authenticated;
