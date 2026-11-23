-- Import drafts: recognised statements, CSV files and receipts that wait here (surviving
-- page changes) until the user confirms them into the pending queue or deletes them.

create table public.import_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('statement', 'csv', 'receipt')),
  status text not null default 'working' check (status in ('working', 'done', 'error')),
  file_name text not null default '',
  image_path text,
  model_used text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index import_drafts_owner on public.import_drafts (owner_id, created_at);

create function public.touch_import_draft() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger import_drafts_touch before update on public.import_drafts
  for each row execute function public.touch_import_draft();

alter table public.import_drafts enable row level security;

create policy import_drafts_own on public.import_drafts for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- A receipt now arrives with the bill itself, so undoing a decision or sending a bill
-- to "later" must keep its items. Only "mine" (personal) drops the receipt.
create or replace function public.reset_transaction(p_tx uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  perform 1 from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  delete from splits where transaction_id = p_tx;
  update transactions set status = 'pending' where id = p_tx;
end $$;

create or replace function public.set_transaction_status(p_tx uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  if p_status not in ('personal', 'later') then raise exception 'invalid_status'; end if;
  update transactions set status = p_status
    where id = p_tx and owner_id = uid and status in ('pending', 'later');
  if not found then raise exception 'stale'; end if;
  if p_status = 'personal' then
    delete from receipts where transaction_id = p_tx;
  end if;
end $$;

revoke execute on function public.touch_import_draft() from public, anon, authenticated;
revoke execute on function public.reset_transaction(uuid) from public, anon;
revoke execute on function public.set_transaction_status(uuid, text) from public, anon;
