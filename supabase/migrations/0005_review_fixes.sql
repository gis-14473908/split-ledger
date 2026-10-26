-- Fixes from the whole-branch review: guard split invariants in the database, aggregate
-- balances server-side, share settlements between linked users, and let an invite link
-- an existing contact instead of creating a duplicate.

-- While a transaction has splits, its amount and status may only change inside the
-- functions below (which clear the splits first). Category edits stay allowed.
create function public.lock_split_transaction() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.amount_pence is distinct from old.amount_pence or new.status is distinct from old.status)
     and exists (select 1 from splits where transaction_id = old.id) then
    raise exception 'locked';
  end if;
  return new;
end $$;

create trigger transactions_lock_split before update on public.transactions
  for each row execute function public.lock_split_transaction();

-- Same as before, plus: only positive spending that is pending, later or already shared,
-- and no negative shares. Status flips to shared before the new splits go in (see trigger).
create or replace function public.set_transaction_split(p_tx uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_user();
  v_amount integer;
  v_status text;
begin
  select amount_pence, status into v_amount, v_status from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  if v_status not in ('pending', 'later', 'shared') or v_amount <= 0 then raise exception 'stale'; end if;

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

-- Swipe left / up. Refuses a card another device already decided, so a stale screen
-- can't turn a shared transaction back into a personal one.
create function public.set_transaction_status(p_tx uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  if p_status not in ('personal', 'later') then raise exception 'invalid_status'; end if;
  update transactions set status = p_status
    where id = p_tx and owner_id = uid and status in ('pending', 'later');
  if not found then raise exception 'stale'; end if;
  delete from receipts where transaction_id = p_tx;
end $$;

-- Only shares in transactions that are currently shared.
create or replace function public.shares_owed_by_me()
returns table (owner_id uuid, owner_name text, transaction_id uuid, occurred_on date,
               merchant text, amount_pence integer, share_pence integer)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  return query
    select t.owner_id, p.display_name, t.id, t.occurred_on, t.merchant, t.amount_pence, s.share_pence
    from splits s
    join contacts c on c.id = s.contact_id
    join transactions t on t.id = s.transaction_id
    join profiles p on p.id = t.owner_id
    where c.linked_user_id = uid and t.owner_id <> uid and t.status = 'shared'
    order by t.occurred_on desc;
end $$;

-- Settlements a linked user recorded against their contact for me.
-- amount_pence is as they recorded it (positive: I paid them).
create function public.counterpart_settlements()
returns table (owner_id uuid, owner_name text, amount_pence integer, settled_on date, note text)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  return query
    select st.owner_id, p.display_name, st.amount_pence, st.settled_on, st.note
    from settlements st
    join contacts c on c.id = st.contact_id
    join profiles p on p.id = st.owner_id
    where c.linked_user_id = uid and st.owner_id <> uid
    order by st.settled_on desc;
end $$;

-- Net balance per contact, positive when they owe me. Mirrors computeBalances() in
-- src/lib/balance.ts, done in SQL so no row limit applies.
create function public.contact_balances() returns table (contact_id uuid, pence bigint)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  return query
  with mine as (
    select c.id, c.linked_user_id from contacts c where c.owner_id = uid
  ),
  owed_to_me as (
    select s.contact_id as cid, sum(s.share_pence) as p
    from splits s join transactions t on t.id = s.transaction_id
    where t.owner_id = uid and t.status = 'shared' and s.contact_id is not null
    group by s.contact_id
  ),
  owed_by_me as (
    select m.id as cid, sum(s.share_pence) as p
    from splits s
    join contacts theirs on theirs.id = s.contact_id and theirs.linked_user_id = uid
    join transactions t on t.id = s.transaction_id and t.owner_id = theirs.owner_id and t.status = 'shared'
    join mine m on m.linked_user_id = theirs.owner_id
    group by m.id
  ),
  settled as (
    select st.contact_id as cid, st.amount_pence as p from settlements st where st.owner_id = uid
    union all
    select m.id, -st.amount_pence
    from settlements st
    join contacts theirs on theirs.id = st.contact_id and theirs.linked_user_id = uid
    join mine m on m.linked_user_id = st.owner_id
  ),
  settled_sum as (select x.cid, sum(x.p) as p from settled x group by x.cid)
  select m.id, (coalesce(a.p, 0) - coalesce(b.p, 0) - coalesce(z.p, 0))::bigint
  from mine m
  left join owed_to_me a on a.cid = m.id
  left join owed_by_me b on b.cid = m.id
  left join settled_sum z on z.cid = m.id
  where a.p is not null or b.p is not null or z.p is not null;
end $$;

-- Who sent this invite (for the confirmation screen). Null for unknown tokens.
create function public.invite_info(p_token text) returns text
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  return (select p.display_name from contacts c join profiles p on p.id = c.owner_id where c.invite_token = p_token);
end $$;

-- accept_invite now optionally links one of the accepter's existing contacts.
drop function public.accept_invite(text);

create function public.accept_invite(p_token text, p_my_contact uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_user();
  c contacts%rowtype;
begin
  select * into c from contacts where invite_token = p_token for update;
  if not found then raise exception 'invite_invalid'; end if;
  if c.owner_id = uid then raise exception 'invite_self'; end if;
  if exists (select 1 from contacts where owner_id = c.owner_id and linked_user_id = uid) then
    raise exception 'invite_already_linked';
  end if;
  if p_my_contact is not null and not exists (
    select 1 from contacts where id = p_my_contact and owner_id = uid and linked_user_id is null
  ) then
    raise exception 'invalid_contact';
  end if;

  perform set_config('app.allow_link', 'on', true);
  update contacts set linked_user_id = uid, invite_token = null where id = c.id;
  if exists (select 1 from contacts where owner_id = uid and linked_user_id = c.owner_id) then
    null; -- already linked from my side
  elsif p_my_contact is not null then
    update contacts set linked_user_id = c.owner_id where id = p_my_contact;
  else
    insert into contacts (owner_id, name, linked_user_id)
      values (uid, (select display_name from profiles where id = c.owner_id), c.owner_id);
  end if;
  return c.id;
end $$;

revoke execute on function public.set_transaction_status(uuid, text) from public, anon;
revoke execute on function public.counterpart_settlements() from public, anon;
revoke execute on function public.contact_balances() from public, anon;
revoke execute on function public.invite_info(text) from public, anon;
revoke execute on function public.accept_invite(text, uuid) from public, anon;
revoke execute on function public.lock_split_transaction() from public, anon, authenticated;
