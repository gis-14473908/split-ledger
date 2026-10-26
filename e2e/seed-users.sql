-- Two confirmed test accounts for the end-to-end smoke test.
-- Run with psql -v pw="'<password>'" or substitute :pw before running via the Supabase SQL editor.
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
values
  ('00000000-0000-0000-0000-000000000000', 'e2e00000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
   'e2e-a@split-ledger.test', extensions.crypt(:pw, extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"测试阿明"}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'e2e00000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
   'e2e-b@split-ledger.test', extensions.crypt(:pw, extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"display_name":"测试同学"}', now(), now(), '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u
where u.id in ('e2e00000-0000-4000-8000-00000000000a', 'e2e00000-0000-4000-8000-00000000000b')
on conflict do nothing;
