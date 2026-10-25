-- split-ledger schema. Money is integer pence throughout.

-- Profiles -------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  default_model text not null default 'sonnet' check (default_model in ('haiku', 'sonnet', 'opus')),
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Contacts -------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  linked_user_id uuid references auth.users (id) on delete set null,
  invite_token text unique,
  created_at timestamptz not null default now(),
  unique (owner_id, linked_user_id)
);

-- Linking a contact to an account is only allowed inside create_invite / accept_invite,
-- otherwise anyone could make another user see debts they never agreed to.
create function public.protect_contact_link() returns trigger
language plpgsql as $$
begin
  if coalesce(current_setting('app.allow_link', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.linked_user_id is not null or new.invite_token is not null) then
    raise exception 'link_protected';
  end if;
  if tg_op = 'UPDATE' and (new.linked_user_id is distinct from old.linked_user_id
                          or new.invite_token is distinct from old.invite_token) then
    raise exception 'link_protected';
  end if;
  return new;
end $$;

create trigger contacts_protect_link before insert or update on public.contacts
  for each row execute function public.protect_contact_link();

-- Imports and transactions -----------------------------------------------------

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('screenshot', 'csv')),
  file_paths text[] not null default '{}',
  model_used text,
  created_at timestamptz not null default now()
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  import_id uuid references public.imports (id) on delete set null,
  occurred_on date not null,
  occurred_at_time time,
  merchant_raw text not null,
  merchant text not null,
  location text,
  amount_pence integer not null,
  original_amount numeric(14, 2),
  original_currency text,
  category text not null default 'other'
    check (category in ('groceries', 'dining', 'transport', 'shopping', 'bills', 'entertainment', 'health', 'transfer', 'other')),
  bank text not null default 'other' check (bank in ('hsbc', 'monzo', 'lloyds', 'cmb', 'other')),
  source text not null check (source in ('screenshot', 'csv', 'manual')),
  status text not null default 'pending' check (status in ('pending', 'personal', 'shared', 'transfer', 'later')),
  ai_hint text,
  dedupe_key text not null,
  created_at timestamptz not null default now()
);

create index transactions_owner_status on public.transactions (owner_id, status);
create index transactions_owner_date on public.transactions (owner_id, occurred_on);
create index transactions_owner_dedupe on public.transactions (owner_id, dedupe_key);

-- Receipts -------------------------------------------------------------------

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null unique references public.transactions (id) on delete cascade,
  image_path text not null,
  total_pence integer not null,
  model_used text,
  created_at timestamptz not null default now()
);

create table public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts (id) on delete cascade,
  name text not null,
  price_pence integer not null,
  includes_me boolean not null default false,
  contact_ids uuid[] not null default '{}',
  position integer not null default 0
);

-- Splits and settlements -------------------------------------------------------

create table public.splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete restrict, -- null = the owner
  share_pence integer not null
);

create index splits_transaction on public.splits (transaction_id);
create index splits_contact on public.splits (contact_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  amount_pence integer not null check (amount_pence <> 0), -- positive: they paid me
  settled_on date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

-- AI usage (rate limiting) -------------------------------------------------------

create table public.ai_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index ai_usage_user_time on public.ai_usage (user_id, created_at);

-- Row level security -------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.contacts enable row level security;
alter table public.imports enable row level security;
alter table public.transactions enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.splits enable row level security;
alter table public.settlements enable row level security;
alter table public.ai_usage enable row level security; -- no policies: only security definer functions touch it

create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy contacts_own on public.contacts for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy imports_own on public.imports for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy transactions_own on public.transactions for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy receipts_own on public.receipts for all to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.transactions t where t.id = transaction_id and t.owner_id = auth.uid()));

create policy receipt_items_own on public.receipt_items for all to authenticated
  using (exists (select 1 from public.receipts r join public.transactions t on t.id = r.transaction_id
                 where r.id = receipt_id and t.owner_id = auth.uid()))
  with check (exists (select 1 from public.receipts r join public.transactions t on t.id = r.transaction_id
                      where r.id = receipt_id and t.owner_id = auth.uid()));

-- Splits are read directly but written only through set_transaction_split, which checks the total.
create policy splits_select_own on public.splits for select to authenticated
  using (exists (select 1 from public.transactions t where t.id = transaction_id and t.owner_id = auth.uid()));

create policy settlements_own on public.settlements for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid()
              and exists (select 1 from public.contacts c where c.id = contact_id and c.owner_id = auth.uid()));
