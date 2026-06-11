create or replace function next_number(seq_key text) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  update sequences set next_value = next_value + 1 where key = seq_key
  returning next_value - 1 into v;
  if v is null then
    insert into sequences (key, next_value) values (seq_key, 2) returning 1 into v;
  end if;
  return v;
end $$;

create or replace function current_app_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- Admin-only user provisioning without service-role key.
-- Inserts directly into auth schema (documented Supabase pattern for seeding/self-hosting).
create extension if not exists pgcrypto;

create or replace function admin_create_user(p_email text, p_password text, p_full_name text, p_role text)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare new_id uuid := gen_random_uuid();
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'only admins can create users';
  end if;
  if p_role not in ('admin','office','supervisor','field') then
    raise exception 'invalid role %', p_role;
  end if;
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );
  insert into public.profiles (id, full_name, role) values (new_id, p_full_name, p_role);
  return new_id;
end $$;

-- Bootstrap variant used exactly once when no users exist at all (cannot pass the admin check).
create or replace function bootstrap_first_admin(p_email text, p_password text, p_full_name text)
returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare new_id uuid;
begin
  if exists (select 1 from public.profiles) then
    raise exception 'bootstrap only allowed when no users exist';
  end if;
  -- temporarily mimic admin path: duplicate the inserts (cannot call admin_create_user due to role check)
  new_id := gen_random_uuid();
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change, email_change_token_new, email_change_token_current
  ) values (
    '00000000-0000-0000-0000-000000000000', new_id, 'authenticated', 'authenticated',
    lower(p_email), extensions.crypt(p_password, extensions.gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', '', ''
  );
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), new_id, new_id::text,
    jsonb_build_object('sub', new_id::text, 'email', lower(p_email), 'email_verified', true),
    'email', now(), now(), now()
  );
  insert into public.profiles (id, full_name, role) values (new_id, p_full_name, 'admin');
  return new_id;
end $$;

revoke execute on function bootstrap_first_admin(text, text, text) from anon, authenticated, public;
revoke execute on function admin_create_user(text, text, text, text) from anon, public;
