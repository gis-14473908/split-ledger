-- Hardening from the Supabase security advisor.

-- Pin search_path on the helpers that don't run as definer.
alter function public.protect_contact_link() set search_path = public;
alter function public.require_user() set search_path = public;

-- The signup trigger function is never meant to be called over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Privileged functions are for signed-in users only.
revoke execute on function public.set_transaction_split(uuid, jsonb) from public, anon;
revoke execute on function public.reset_transaction(uuid) from public, anon;
revoke execute on function public.create_invite(uuid) from public, anon;
revoke execute on function public.accept_invite(text) from public, anon;
revoke execute on function public.shares_owed_by_me() from public, anon;
revoke execute on function public.ai_rate_check(text, text) from public, anon;
revoke execute on function public.monthly_spend(date) from public, anon;
