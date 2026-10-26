-- SQL tests for schema, RLS and functions. Run via scripts/test-db.sh.
-- Users: A = aaaa…, B = bbbb…, C = cccc…

create schema tests;
grant usage on schema tests to authenticated;

create function tests.as_user(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false);
$$;

-- Runs stmt and fails unless it raises an error whose message contains `expected`.
create function tests.expect_error(stmt text, expected text) returns void language plpgsql as $$
declare
  succeeded boolean := false;
begin
  begin
    execute stmt;
    succeeded := true;
  exception when others then
    if position(expected in sqlerrm) = 0 then
      raise exception 'expected error "%", got "%" from: %', expected, sqlerrm, stmt;
    end if;
  end;
  if succeeded then
    raise exception 'expected error "%" but statement succeeded: %', expected, stmt;
  end if;
end $$;
grant execute on all functions in schema tests to authenticated;

insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@x.test', '{"display_name": "阿明"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@x.test', '{"display_name": "孙豪"}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@x.test', '{}');

do $$ begin
  assert (select display_name from public.profiles where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') = 'c',
    'profile display_name falls back to the email name';
  assert (select default_model from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 'sonnet',
    'default model is sonnet';
end $$;

set role authenticated;

-- B sets up one contact of their own.
select tests.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.contacts (id, name) values ('b1b1b1b1-0000-4000-8000-000000000001', '路人');

-- A's ledger.
select tests.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.contacts (id, name) values
  ('a1a1a1a1-0000-4000-8000-000000000001', '孙豪'),
  ('a1a1a1a1-0000-4000-8000-000000000002', '李明');
insert into public.transactions (id, occurred_on, merchant_raw, merchant, amount_pence, category, source, status, dedupe_key) values
  ('11111111-0000-4000-8000-000000000001', '2026-10-22', 'TESCO 3021', 'Tesco', 1000, 'groceries', 'screenshot', 'pending', 'k1'),
  ('11111111-0000-4000-8000-000000000002', '2026-10-22', 'PRET', 'Pret', 500, 'groceries', 'screenshot', 'personal', 'k2'),
  ('11111111-0000-4000-8000-000000000003', '2026-10-23', 'SALARY', 'Salary', 3000, 'transfer', 'screenshot', 'transfer', 'k3'),
  ('11111111-0000-4000-8000-000000000004', '2026-09-30', 'NANDOS', 'Nando''s', 700, 'dining', 'screenshot', 'pending', 'k4');

-- Contacts cannot be linked to an account by a plain write.
select tests.expect_error(
  $q$update public.contacts set linked_user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'a1a1a1a1-0000-4000-8000-000000000001'$q$,
  'link_protected');
select tests.expect_error(
  $q$insert into public.contacts (name, linked_user_id) values ('x', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$q$,
  'link_protected');

-- Splits.
select public.set_transaction_split('11111111-0000-4000-8000-000000000001', '[
  {"contact_id": null, "share_pence": 334},
  {"contact_id": "a1a1a1a1-0000-4000-8000-000000000001", "share_pence": 333},
  {"contact_id": "a1a1a1a1-0000-4000-8000-000000000002", "share_pence": 333}]');
do $$ begin
  assert (select status from public.transactions where id = '11111111-0000-4000-8000-000000000001') = 'shared',
    'split marks the transaction shared';
  assert (select count(*) from public.splits where transaction_id = '11111111-0000-4000-8000-000000000001') = 3,
    'three split rows';
end $$;
select tests.expect_error(
  $q$select public.set_transaction_split('11111111-0000-4000-8000-000000000001', '[{"contact_id": null, "share_pence": 999}]')$q$,
  'shares_mismatch');
select tests.expect_error(
  $q$select public.set_transaction_split('11111111-0000-4000-8000-000000000001', '[{"contact_id": "b1b1b1b1-0000-4000-8000-000000000001", "share_pence": 1000}]')$q$,
  'invalid_contact');
select tests.expect_error(
  $q$select public.set_transaction_split('11111111-0000-4000-8000-000000000001', '[
    {"contact_id": "a1a1a1a1-0000-4000-8000-000000000001", "share_pence": 500},
    {"contact_id": "a1a1a1a1-0000-4000-8000-000000000001", "share_pence": 500}]')$q$,
  'invalid_shares');
select tests.expect_error(
  $q$insert into public.splits (transaction_id, contact_id, share_pence) values ('11111111-0000-4000-8000-000000000002', null, 500)$q$,
  'row-level security');

-- Reset clears shares and the receipt.
select public.set_transaction_split('11111111-0000-4000-8000-000000000004', '[{"contact_id": null, "share_pence": 700}]');
insert into public.receipts (id, transaction_id, image_path, total_pence)
  values ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/receipt/x.jpg', 700);
insert into public.receipt_items (receipt_id, name, price_pence, includes_me)
  values ('22222222-0000-4000-8000-000000000001', 'Chicken', 700, true);
select public.reset_transaction('11111111-0000-4000-8000-000000000004');
do $$ begin
  assert (select count(*) from public.splits where transaction_id = '11111111-0000-4000-8000-000000000004') = 0, 'reset removes splits';
  assert (select count(*) from public.receipts where transaction_id = '11111111-0000-4000-8000-000000000004') = 0, 'reset removes receipt';
  assert (select count(*) from public.receipt_items) = 0, 'reset removes receipt items';
  assert (select status from public.transactions where id = '11111111-0000-4000-8000-000000000004') = 'pending', 'reset back to pending';
end $$;

-- Monthly spend: personal 500 + my share 334 of the shared Tesco; the transfer is excluded.
do $$
declare r record;
begin
  select * into r from public.monthly_spend('2026-10-15') where category = 'groceries';
  assert r.pence = 834, format('groceries spend is 834, got %s', r.pence);
  assert r.pending_count = 0, format('no pending in October, got %s', r.pending_count);
  assert not exists (select 1 from public.monthly_spend('2026-10-01') where category = 'transfer'), 'transfers are not spend';
  assert (select pending_count from public.monthly_spend('2026-09-01') limit 1) = 1, 'September has one pending';
end $$;

-- B cannot see A's data.
select tests.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  assert (select count(*) from public.transactions) = 0, 'B sees no transactions of A';
  assert (select count(*) from public.contacts where owner_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0, 'B sees no contacts of A';
  assert (select count(*) from public.splits) = 0, 'B sees no splits of A';
  assert (select count(*) from public.shares_owed_by_me()) = 0, 'nothing owed before linking';
end $$;

-- Invites.
select tests.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
create temp table invite as select public.create_invite('a1a1a1a1-0000-4000-8000-000000000001') as token;
do $$ begin
  assert length((select token from invite)) >= 32, 'token is long and random';
end $$;
select tests.expect_error(
  format('select public.accept_invite(%L)', (select token from invite)), 'invite_self');

select tests.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$ begin
  assert public.accept_invite((select token from invite)) = 'a1a1a1a1-0000-4000-8000-000000000001', 'accept returns the contact';
  assert (select name from public.contacts where linked_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = '阿明',
    'B gets a reciprocal contact named after A';
end $$;

select tests.as_user('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
select tests.expect_error(format('select public.accept_invite(%L)', (select token from invite)), 'invite_invalid');

-- After linking, B sees exactly the share A assigned to them.
select tests.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
do $$
declare r record;
begin
  assert (select count(*) from public.shares_owed_by_me()) = 1, 'one share owed';
  select * into r from public.shares_owed_by_me();
  assert r.share_pence = 333 and r.owner_name = '阿明' and r.merchant = 'Tesco' and r.amount_pence = 1000,
    'owed share details';
end $$;

-- A second invite from A to B is refused once B is already linked to A.
select tests.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
create temp table invite2 as select public.create_invite('a1a1a1a1-0000-4000-8000-000000000002') as token;
select tests.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select tests.expect_error(format('select public.accept_invite(%L)', (select token from invite2)), 'invite_already_linked');

-- Rate limit: 10 AI calls a minute.
do $$ begin
  for i in 1..10 loop
    perform public.ai_rate_check('statement', 'sonnet');
  end loop;
end $$;
select tests.expect_error($q$select public.ai_rate_check('statement', 'sonnet')$q$, 'rate_limited');

-- Signed-out callers are refused.
select set_config('request.jwt.claim.sub', '', false);
select tests.expect_error($q$select public.ai_rate_check('statement', 'sonnet')$q$, 'not_authenticated');

reset role;

-- The anon role cannot call the privileged functions at all.
grant usage on schema tests to anon;
grant execute on all functions in schema tests to anon;
set role anon;
select tests.expect_error($q$select public.accept_invite('x')$q$, 'permission denied');
select tests.expect_error($q$select * from public.contact_balances()$q$, 'permission denied');
select tests.expect_error($q$select public.set_transaction_split('11111111-0000-4000-8000-000000000001', '[]')$q$, 'permission denied');
select tests.expect_error($q$select * from public.shares_owed_by_me()$q$, 'permission denied');
reset role;

-- Review fixes (0005) ----------------------------------------------------------
set role authenticated;
select tests.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.transactions (id, occurred_on, merchant_raw, merchant, amount_pence, category, source, status, dedupe_key) values
  ('11111111-0000-4000-8000-000000000005', '2026-10-24', 'PRET', 'Pret', 1000, 'dining', 'screenshot', 'pending', 'k5');

-- Splits only for pending/later spending, never negative shares.
select tests.expect_error($q$select public.set_transaction_split('11111111-0000-4000-8000-000000000003', '[{"contact_id": null, "share_pence": 3000}]')$q$, 'stale');
select tests.expect_error($q$select public.set_transaction_split('11111111-0000-4000-8000-000000000005', '[
  {"contact_id": null, "share_pence": 3000},
  {"contact_id": "a1a1a1a1-0000-4000-8000-000000000002", "share_pence": -2000}]')$q$, 'invalid_shares');

-- Personal / later go through a guarded status change.
select public.set_transaction_status('11111111-0000-4000-8000-000000000005', 'personal');
select tests.expect_error($q$select public.set_transaction_status('11111111-0000-4000-8000-000000000005', 'later')$q$, 'stale');
select tests.expect_error($q$select public.set_transaction_status('11111111-0000-4000-8000-000000000001', 'personal')$q$, 'stale');

-- A shared transaction's amount and status are locked while it has splits.
select tests.expect_error($q$update public.transactions set amount_pence = 1 where id = '11111111-0000-4000-8000-000000000001'$q$, 'locked');
select tests.expect_error($q$update public.transactions set status = 'personal' where id = '11111111-0000-4000-8000-000000000001'$q$, 'locked');

-- B records spending shared with A, and a payment A made to B.
select tests.as_user('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.transactions (id, occurred_on, merchant_raw, merchant, amount_pence, category, source, status, dedupe_key) values
  ('33333333-0000-4000-8000-000000000001', '2026-10-24', 'DOMINOS', 'Domino''s', 400, 'dining', 'screenshot', 'pending', 'kb1');
do $$
declare b_to_a uuid := (select id from public.contacts where linked_user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
begin
  perform public.set_transaction_split('33333333-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object('contact_id', null, 'share_pence', 200),
                      jsonb_build_object('contact_id', b_to_a, 'share_pence', 200)));
  insert into public.settlements (contact_id, amount_pence, settled_on) values (b_to_a, 100, '2026-10-25');
end $$;

-- A's balances: B owes 333 - 200 + 100 (A paid B £1) = 233; 李明 owes 333.
select tests.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
do $$ begin
  assert (select pence from public.contact_balances() where contact_id = 'a1a1a1a1-0000-4000-8000-000000000001') = 233,
    format('balance with B is 233, got %s', (select pence from public.contact_balances() where contact_id = 'a1a1a1a1-0000-4000-8000-000000000001'));
  assert (select pence from public.contact_balances() where contact_id = 'a1a1a1a1-0000-4000-8000-000000000002') = 333, 'balance with 李明 is 333';
  assert (select count(*) from public.counterpart_settlements()) = 1, 'A sees the settlement B recorded';
  assert (select amount_pence from public.counterpart_settlements()) = 100, 'counterpart settlement amount as B recorded it';
end $$;

-- Linking an existing name-only contact instead of creating a duplicate.
select tests.as_user('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.contacts (id, name) values ('c3c3c3c3-0000-4000-8000-000000000001', '阿明手写');
select tests.as_user('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.contacts (id, name) values ('a1a1a1a1-0000-4000-8000-000000000003', '小C');
create temp table invite3 as select public.create_invite('a1a1a1a1-0000-4000-8000-000000000003') as token;
select tests.as_user('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
do $$ begin
  assert public.invite_info((select token from invite3)) = '阿明', 'invite shows who sent it';
  assert public.invite_info('nope') is null, 'unknown token has no info';
end $$;
select tests.expect_error(
  format('select public.accept_invite(%L, %L)', (select token from invite3), 'a1a1a1a1-0000-4000-8000-000000000001'), 'invalid_contact');
do $$ begin
  perform public.accept_invite((select token from invite3), 'c3c3c3c3-0000-4000-8000-000000000001');
  assert (select linked_user_id from public.contacts where id = 'c3c3c3c3-0000-4000-8000-000000000001') = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'existing contact is linked';
  assert (select count(*) from public.contacts) = 1, 'no duplicate contact created';
end $$;
reset role;
