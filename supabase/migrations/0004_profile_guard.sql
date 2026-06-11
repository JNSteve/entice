-- Guard against profile self-promotion: the profiles UPDATE policy allows
-- id = auth.uid(), which would otherwise let any user change their own
-- role/active/hourly_cost. Trigger blocks those column changes for non-admins.

create or replace function enforce_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role
      or new.active is distinct from old.active
      or new.hourly_cost is distinct from old.hourly_cost)
     and coalesce(current_app_role(), '') <> 'admin' then
    raise exception 'only admins can change role, active or hourly_cost';
  end if;
  return new;
end $$;

drop trigger if exists profile_guard on profiles;
create trigger profile_guard before update on profiles
  for each row execute function enforce_profile_guard();
