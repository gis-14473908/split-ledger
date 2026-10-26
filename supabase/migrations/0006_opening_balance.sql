-- Opening balances: debts that existed before either person used the app.
-- Stored in settlements with kind 'opening' and the same sign rule as a payment
-- (positive: they paid me / I owe them; negative: they owe me), so every balance
-- calculation picks them up unchanged.
alter table public.settlements
  add column kind text not null default 'payment' check (kind in ('payment', 'opening'));

drop function public.counterpart_settlements();

create function public.counterpart_settlements()
returns table (owner_id uuid, owner_name text, amount_pence integer, settled_on date, note text, kind text)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.require_user();
begin
  return query
    select st.owner_id, p.display_name, st.amount_pence, st.settled_on, st.note, st.kind
    from settlements st
    join contacts c on c.id = st.contact_id
    join profiles p on p.id = st.owner_id
    where c.linked_user_id = uid and st.owner_id <> uid
    order by st.settled_on desc;
end $$;

revoke execute on function public.counterpart_settlements() from public, anon;
