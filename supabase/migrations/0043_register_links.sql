-- Register-scope links: a per-site, compliance-only portal view suitable for
-- printing as an on-site "asbestos register" QR poster (the register must be
-- readily accessible at the workplace).
alter table client_links
  add column scope text not null default 'full' check (scope in ('full','register')),
  add column site_id uuid references sites(id);
-- register links must pin a site
alter table client_links
  add constraint client_links_register_site check (scope <> 'register' or site_id is not null);

-- portal_resolve_link: expose client_id (compliance-report route), scope and
-- site_id (register-only links). Extends the 0029 definition verbatim.
create or replace function portal_resolve_link(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_client_name text;
  s settings%rowtype;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  select name into v_client_name from clients where id = l.client_id;
  select * into s from settings where id = 1;

  return jsonb_build_object(
    'client_id', l.client_id,
    'client_name', v_client_name,
    'label', l.label,
    'company_name', coalesce(s.company_name, 'Entice'),
    'logo_path', s.logo_path,
    'company_phone', s.phone,
    'company_email', s.email,
    'company_address', s.address,
    'company_abn', s.abn,
    'show_financials', l.show_financials,
    'scope', l.scope,
    'site_id', l.site_id);
end $$;
