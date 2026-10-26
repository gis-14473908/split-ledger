-- Remove everything the smoke test created for the two e2e accounts (keeps the accounts).
delete from public.settlements where owner_id in ('e2e00000-0000-4000-8000-00000000000a', 'e2e00000-0000-4000-8000-00000000000b');
delete from public.transactions where owner_id in ('e2e00000-0000-4000-8000-00000000000a', 'e2e00000-0000-4000-8000-00000000000b');
delete from public.imports where owner_id in ('e2e00000-0000-4000-8000-00000000000a', 'e2e00000-0000-4000-8000-00000000000b');
delete from public.contacts where owner_id in ('e2e00000-0000-4000-8000-00000000000a', 'e2e00000-0000-4000-8000-00000000000b');
delete from public.ai_usage where user_id in ('e2e00000-0000-4000-8000-00000000000a', 'e2e00000-0000-4000-8000-00000000000b');
