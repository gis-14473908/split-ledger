-- "AA" bills: the group already paid the restaurant in equal parts, so only the difference
-- between what each person ate and their equal part is owed.
--   each     everyone paid their own equal part by card. The bill's amount becomes my part, and
--            each friend's share is (what they had - their part): negative when they had less
--            than they paid, i.e. I owe them. Negative shares are only allowed in this mode.
--   paid_all I paid the whole bill and friends already transferred their equal parts. Shares
--            are the normal ones; each transfer is recorded as a settlement tied to the bill.

alter table public.transactions
  add column aa_mode text check (aa_mode in ('each', 'paid_all')),
  add column aa_original_pence integer;

alter table public.settlements
  add column transaction_id uuid references public.transactions (id) on delete cascade;

-- Undo whatever AA left behind on a bill, ready for a new split (caller holds the row lock).
create function public.clear_aa(p_tx uuid) returns integer
language plpgsql set search_path = public as $$
declare v_mode text; v_orig integer; v_amount integer;
begin
  select aa_mode, aa_original_pence, amount_pence into v_mode, v_orig, v_amount from transactions where id = p_tx;
  if v_mode is null then return v_amount; end if;
  delete from splits where transaction_id = p_tx;
  delete from settlements where transaction_id = p_tx;
  update transactions
    set amount_pence = coalesce(case when v_mode = 'each' then v_orig end, amount_pence),
        aa_mode = null, aa_original_pence = null
    where id = p_tx;
  return coalesce(case when v_mode = 'each' then v_orig end, v_amount);
end $$;

create or replace function public.set_transaction_split(p_tx uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_user();
  v_amount integer;
  v_status text;
begin
  select amount_pence, status into v_amount, v_status from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_status not in ('pending', 'later', 'shared') then raise exception 'stale'; end if;
  v_amount := public.clear_aa(p_tx);
  if v_amount <= 0 then raise exception 'stale'; end if;

  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'invalid_shares';
  end if;
  if (select count(distinct coalesce(e ->> 'contact_id', 'me')) from jsonb_array_elements(p_shares) e)
     <> jsonb_array_length(p_shares)
     or exists (select 1 from jsonb_array_elements(p_shares) e where (e ->> 'share_pence')::integer < 0) then
    raise exception 'invalid_shares';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) e
    where e ->> 'contact_id' is not null
      and not exists (select 1 from contacts c where c.id = (e ->> 'contact_id')::uuid and c.owner_id = uid)
  ) then
    raise exception 'invalid_contact';
  end if;
  if (select coalesce(sum((e ->> 'share_pence')::integer), 0) from jsonb_array_elements(p_shares) e) <> v_amount then
    raise exception 'shares_mismatch';
  end if;

  delete from splits where transaction_id = p_tx;
  update transactions set status = 'shared' where id = p_tx;
  insert into splits (transaction_id, contact_id, share_pence)
    select p_tx, (e ->> 'contact_id')::uuid, (e ->> 'share_pence')::integer from jsonb_array_elements(p_shares) e;
end $$;

-- p_paid: [{"contact_id": uuid, "share_pence": int}] what each friend already paid (paid_all only).
-- p_amount: the bill's new amount (each only), my equal part.
create function public.set_transaction_split_aa(p_tx uuid, p_shares jsonb, p_mode text, p_paid jsonb, p_amount integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_user();
  v_amount integer;
  v_status text;
  v_date date;
  v_merchant text;
  v_target integer;
begin
  if p_mode not in ('each', 'paid_all') then raise exception 'invalid_shares'; end if;
  select amount_pence, status, occurred_on, merchant into v_amount, v_status, v_date, v_merchant
    from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_status not in ('pending', 'later', 'shared') then raise exception 'stale'; end if;
  v_amount := public.clear_aa(p_tx);
  if v_amount <= 0 then raise exception 'stale'; end if;
  delete from splits where transaction_id = p_tx;

  if p_mode = 'each' then
    if p_amount is null or p_amount <= 0 then raise exception 'invalid_shares'; end if;
    v_target := p_amount;
    update transactions set amount_pence = p_amount, aa_mode = 'each', aa_original_pence = v_amount,
      status = 'shared' where id = p_tx;
  else
    v_target := v_amount;
    update transactions set aa_mode = 'paid_all', status = 'shared' where id = p_tx;
  end if;

  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then raise exception 'invalid_shares'; end if;
  if (select count(distinct coalesce(e ->> 'contact_id', 'me')) from jsonb_array_elements(p_shares) e)
     <> jsonb_array_length(p_shares) then
    raise exception 'invalid_shares';
  end if;
  -- Only an "each" bill may carry a negative share, and never mine.
  if exists (
    select 1 from jsonb_array_elements(p_shares) e
    where (e ->> 'share_pence')::integer < 0 and (p_mode <> 'each' or e ->> 'contact_id' is null)
  ) then
    raise exception 'invalid_shares';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_shares) e
    where e ->> 'contact_id' is not null
      and not exists (select 1 from contacts c where c.id = (e ->> 'contact_id')::uuid and c.owner_id = uid)
  ) then
    raise exception 'invalid_contact';
  end if;
  if (select coalesce(sum((e ->> 'share_pence')::integer), 0) from jsonb_array_elements(p_shares) e) <> v_target then
    raise exception 'shares_mismatch';
  end if;

  insert into splits (transaction_id, contact_id, share_pence)
    select p_tx, (e ->> 'contact_id')::uuid, (e ->> 'share_pence')::integer from jsonb_array_elements(p_shares) e;

  if p_mode = 'paid_all' and p_paid is not null and jsonb_typeof(p_paid) = 'array' then
    if exists (
      select 1 from jsonb_array_elements(p_paid) e
      where e ->> 'contact_id' is null or (e ->> 'share_pence')::integer <= 0
         or not exists (select 1 from contacts c where c.id = (e ->> 'contact_id')::uuid and c.owner_id = uid)
    ) then
      raise exception 'invalid_shares';
    end if;
    insert into settlements (owner_id, contact_id, amount_pence, settled_on, note, transaction_id)
      select uid, (e ->> 'contact_id')::uuid, (e ->> 'share_pence')::integer, v_date, 'AA 已付：' || v_merchant, p_tx
      from jsonb_array_elements(p_paid) e;
  end if;
end $$;

create or replace function public.reset_transaction(p_tx uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  perform 1 from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  delete from splits where transaction_id = p_tx;
  perform public.clear_aa(p_tx);
  update transactions set status = 'pending' where id = p_tx;
end $$;

revoke execute on function public.clear_aa(uuid) from public, anon, authenticated;
revoke execute on function public.set_transaction_split(uuid, jsonb) from public, anon;
revoke execute on function public.set_transaction_split_aa(uuid, jsonb, text, jsonb, integer) from public, anon;
revoke execute on function public.reset_transaction(uuid) from public, anon;
