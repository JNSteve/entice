-- Advisor-driven hardening:
-- 1. Trigger function should never be RPC-callable
revoke execute on function enforce_profile_guard() from anon, authenticated, public;
-- 2. Anonymous users have no business with these
revoke execute on function current_app_role() from anon;
revoke execute on function next_number(text) from anon;
-- 3. Public bucket doesn't need a listing policy (object URLs work without it)
drop policy if exists "branding_select_all" on storage.objects;
