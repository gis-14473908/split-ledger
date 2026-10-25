-- Functions the app calls through supabase.rpc(). Security definer functions check
-- auth.uid() themselves because they bypass row level security.

create function public.require_user() returns uuid
language plpgsql stable as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  return uid;
end $$;

-- Replace a transaction's split. p_shares: [{"contact_id": uuid | null, "share_pence": int}]
create function public.set_transaction_split(p_tx uuid, p_shares jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_user();
  v_amount integer;
begin
  select amount_pence into v_amount from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;

  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'invalid_shares';
  end if;
  if (select count(distinct coalesce(e ->> 'contact_id', 'me')) from jsonb_array_elements(p_shares) e)
     <> jsonb_array_length(p_shares) then
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
  insert into splits (transaction_id, contact_id, share_pence)
    select p_tx, (e ->> 'contact_id')::uuid, (e ->> 'share_pence')::integer from jsonb_array_elements(p_shares) e;
  update transactions set status = 'shared' where id = p_tx;
end $$;

-- Undo a decision: drop splits and receipt, back to pending.
create function public.reset_transaction(p_tx uuid) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  perform 1 from transactions where id = p_tx and owner_id = uid for update;
  if not found then raise exception 'not_found'; end if;
  delete from splits where transaction_id = p_tx;
  delete from receipts where transaction_id = p_tx;
  update transactions set status = 'pending' where id = p_tx;
end $$;

create function public.create_invite(p_contact uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := public.require_user();
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  perform set_config('app.allow_link', 'on', true);
  update contacts set invite_token = v_token
    where id = p_contact and owner_id = uid and linked_user_id is null;
  if not found then raise exception 'invite_unavailable'; end if;
  return v_token;
end $$;

create function public.accept_invite(p_token text) returns uuid
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

  perform set_config('app.allow_link', 'on', true);
  update contacts set linked_user_id = uid, invite_token = null where id = c.id;
  if not exists (select 1 from contacts where owner_id = uid and linked_user_id = c.owner_id) then
    insert into contacts (owner_id, name, linked_user_id)
      values (uid, (select display_name from profiles where id = c.owner_id), c.owner_id);
  end if;
  return c.id;
end $$;

-- Shares other people assigned to me in their own ledgers.
create function public.shares_owed_by_me()
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
    where c.linked_user_id = uid and t.owner_id <> uid
    order by t.occurred_on desc;
end $$;

-- What I spent in the month containing p_month, by category. Runs with the caller's
-- rights, so row level security already limits it to their own rows.
create function public.monthly_spend(p_month date)
returns table (category text, pence bigint, pending_count integer)
language sql stable set search_path = public as $$
  with bounds as (
    select date_trunc('month', p_month)::date as m_start,
           (date_trunc('month', p_month) + interval '1 month')::date as m_end
  ),
  mine as (
    select t.*
    from transactions t, bounds b
    where t.owner_id = auth.uid() and t.occurred_on >= b.m_start and t.occurred_on < b.m_end
  ),
  spend as (
    select t.category,
           case when t.status = 'shared'
                then coalesce((select sum(s.share_pence) from splits s
                               where s.transaction_id = t.id and s.contact_id is null), 0)
                else t.amount_pence end as pence
    from mine t
    where t.status <> 'transfer' and t.amount_pence > 0
  ),
  pending as (
    select count(*)::integer as n from mine where status in ('pending', 'later')
  )
  select s.category, sum(s.pence)::bigint, (select n from pending)
  from spend s
  group by s.category
  union all
  -- keep the pending count visible even in a month with no spend rows
  select null, 0, (select n from pending)
  where not exists (select 1 from spend)
$$;

create function public.ai_rate_check(p_kind text, p_model text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  if (select count(*) from ai_usage where user_id = uid and created_at > now() - interval '60 seconds') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into ai_usage (user_id, kind, model) values (uid, p_kind, p_model);
end $$;
