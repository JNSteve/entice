-- A portal work request can reference the compliance item that triggered it
-- (the "red light -> request re-inspection" loop).
alter table portal_requests
  add column compliance_item_id uuid references property_compliance_items(id);
create index portal_requests_compliance_item_idx
  on portal_requests (compliance_item_id) where compliance_item_id is not null;

-- Replace the submit RPC with an optional compliance-item param. The item
-- must belong to the same site (and therefore the same client as the link).
drop function portal_submit_request(text, uuid, text, text, text, text[]);
create function portal_submit_request(
  p_token text, p_site uuid, p_title text, p_description text,
  p_urgency text, p_photo_paths text[] default '{}',
  p_compliance_item uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_title text := left(trim(coalesce(p_title, '')), 200);
  v_desc text := trim(coalesce(p_description, ''));
  v_paths text[] := coalesce(p_photo_paths, '{}');
  v_prefix text;
  v_path text;
  v_number text;
  v_id uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if p_compliance_item is not null and not exists (
    select 1 from property_compliance_items
    where id = p_compliance_item and site_id = p_site
  ) then
    return null;
  end if;

  if v_title = '' or v_desc = '' or char_length(v_desc) > 4000
     or p_urgency not in ('low','normal','high','urgent')
     or coalesce(array_length(v_paths, 1), 0) > 5 then
    return jsonb_build_object('error', 'invalid');
  end if;

  v_prefix := 'portal-requests/' || l.id::text || '/';
  foreach v_path in array v_paths loop
    if v_path not like v_prefix || '%' or position('..' in v_path) > 0 then
      return jsonb_build_object('error', 'invalid');
    end if;
  end loop;

  if (select count(*) from portal_requests
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_number := 'REQ-' || lpad(next_number('portal_request')::text, 4, '0');

  insert into portal_requests
    (number, client_id, site_id, client_link_id, title, description,
     urgency, photo_paths, compliance_item_id)
  values (v_number, l.client_id, p_site, l.id, v_title, v_desc,
          p_urgency, v_paths, p_compliance_item)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'number', v_number, 'id', v_id);
end $$;
grant execute on function portal_submit_request(text, uuid, text, text, text, text[], uuid) to anon, authenticated;
