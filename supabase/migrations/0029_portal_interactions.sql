-- 0029_portal_interactions.sql
-- Client Portal CP2b — interactions (roadmap
-- docs/superpowers/plans/2026-07-03-client-portal-roadmap.md §CP2b).
--
--   * portal_messages — correspondence thread per property. Anchored on
--     (client_id, site_id) — NOT the link — so revoking/reissuing a portal
--     link preserves the client's history. client_link_id is traceability
--     only (which link wrote it) and drives the per-link rate limit.
--   * portal_requests — client work requests (REQ-xxxx via
--     next_number('portal_request')): title/description/urgency/photos →
--     office register → convert-to-quote (quote_id linkage).
--   * portal_acceptances — sign-on-the-glass evidence for quote/variation
--     decisions made through the portal (signer name + signature PNG +
--     timestamp + ip). One 'accepted' row per target, enforced by a partial
--     unique index AND the status-guarded UPDATE in portal_accept().
--   * quotes.portal_published / variations.portal_published — office chooses
--     what is signable; nothing is visible in the portal unless published.
--   * client_links.show_financials — per-link gate for the Billing tab
--     (issued invoices/claims for the property). Default OFF.
--
-- Security shape is identical to CP1/CP2a: NO anon table policies anywhere.
-- Every anonymous write goes through a SECURITY DEFINER function that
-- validates the token internally (portal_live_link), enforces rate limits and
-- returns null for dead tokens (no probing surface). Status transitions made
-- by portal_accept are the SAME transitions the office actions use
-- (quote sent→accepted, variation submitted→approved, decided_at stamped) —
-- see src/app/(office)/quotes/actions.ts and projects/[id]/variations/actions.ts.

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table portal_messages (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  -- Traceability only — the thread survives link reissue/revocation.
  client_link_id uuid references client_links(id) on delete set null,
  sender text not null check (sender in ('client','office')),
  sender_profile_id uuid references profiles(id),
  sender_name text check (sender_name is null or char_length(sender_name) <= 120),
  body text not null check (char_length(body) between 1 and 2000),
  read_by_office boolean not null default false,
  read_by_client boolean not null default false,
  created_at timestamptz not null default now(),
  -- office messages carry a profile, client messages a free-text name
  check (
    (sender = 'office' and sender_profile_id is not null)
    or (sender = 'client' and sender_name is not null)
  )
);
create index portal_messages_thread_idx on portal_messages (client_id, site_id, created_at);
create index portal_messages_office_unread_idx on portal_messages (client_id)
  where sender = 'client' and not read_by_office;

create table portal_requests (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,          -- REQ-0001 via next_number('portal_request')
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  client_link_id uuid references client_links(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 4000),
  urgency text not null default 'normal'
    check (urgency in ('low','normal','high','urgent')),
  -- Uploaded through the guarded /portal/[token]/request-upload route; the
  -- submit fn additionally pins every path to the uploading link's prefix.
  photo_paths text[] not null default '{}'
    check (coalesce(array_length(photo_paths, 1), 0) <= 5),
  status text not null default 'submitted'
    check (status in ('submitted','reviewed','quoted','scheduled','completed','declined')),
  quote_id uuid references quotes(id) on delete set null,
  handled_by uuid references profiles(id),
  handled_notes text check (handled_notes is null or char_length(handled_notes) <= 2000),
  created_at timestamptz not null default now()
);
create index portal_requests_client_idx on portal_requests (client_id, created_at desc);
create index portal_requests_site_idx on portal_requests (site_id);
create index portal_requests_status_idx on portal_requests (status);

create table portal_acceptances (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('quote','variation')),
  target_id uuid not null,
  client_id uuid not null references clients(id) on delete cascade,
  client_link_id uuid references client_links(id) on delete set null,
  action text not null check (action in ('accepted','declined')),
  signer_name text not null check (char_length(signer_name) between 1 and 120),
  -- PNG data URL from the signature pad; required for accepts, absent for
  -- declines. Same ceiling as form sign-ons (~100KB PNG as base64).
  signature_data text check (
    (action = 'accepted'
      and signature_data like 'data:image/png;base64,%'
      and char_length(signature_data) <= 140000)
    or (action = 'declined' and signature_data is null)
  ),
  reason text check (
    (action = 'declined' and char_length(reason) between 1 and 1000)
    or (action = 'accepted' and reason is null)
  ),
  ip inet,
  signed_at timestamptz not null default now()
);
create index portal_acceptances_target_idx on portal_acceptances (kind, target_id);
create index portal_acceptances_client_idx on portal_acceptances (client_id, signed_at desc);
-- Belt & braces against double-accept (the status-guarded UPDATE is the lock).
create unique index portal_acceptances_one_accept_idx
  on portal_acceptances (kind, target_id) where action = 'accepted';

-- Office chooses what the portal may show/sign. Publishing is only offered on
-- signable statuses (quote 'sent', variation 'submitted') in the UI; the
-- portal fns re-check status anyway.
alter table quotes     add column portal_published boolean not null default false;
alter table variations add column portal_published boolean not null default false;

-- Billing tab gate — per link, default OFF.
alter table client_links add column show_financials boolean not null default false;

------------------------------------------------------------------------------
-- 2. RLS — staff side only; NO anon policies on any table
------------------------------------------------------------------------------

alter table portal_messages    enable row level security;
alter table portal_requests    enable row level security;
alter table portal_acceptances enable row level security;

-- portal_messages: admin/office read + reply + mark-read; nothing else.
create policy portal_messages_select_admin_office on portal_messages
  for select to authenticated
  using (current_app_role() in ('admin','office'));
create policy portal_messages_insert_office on portal_messages
  for insert to authenticated
  with check (
    current_app_role() in ('admin','office')
    and sender = 'office'
    and sender_profile_id = auth.uid()
  );
create policy portal_messages_update_admin_office on portal_messages
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
-- No DELETE for anyone — the thread doubles as the correspondence log.

-- Guard: staff updates may only flip the read flags; body/sender are frozen.
create function portal_messages_update_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - 'read_by_office' - 'read_by_client')
     is distinct from
     (to_jsonb(old) - 'read_by_office' - 'read_by_client') then
    raise exception 'only read flags may be updated on portal_messages';
  end if;
  return new;
end $$;
revoke execute on function portal_messages_update_guard() from anon, authenticated, public;

create trigger portal_messages_update_guard
  before update on portal_messages
  for each row execute function portal_messages_update_guard();

-- portal_requests: admin/office manage; supervisor read-only; field none.
create policy portal_requests_select_staff on portal_requests
  for select to authenticated
  using (current_app_role() in ('admin','office','supervisor'));
create policy portal_requests_insert_admin_office on portal_requests
  for insert to authenticated
  with check (current_app_role() in ('admin','office'));
create policy portal_requests_update_admin_office on portal_requests
  for update to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy portal_requests_delete_admin on portal_requests
  for delete to authenticated
  using (current_app_role() = 'admin');

-- portal_acceptances: staff read-only evidence. Writes happen exclusively in
-- portal_accept()/portal_decline() — no INSERT/UPDATE/DELETE policy at all.
create policy portal_acceptances_select_admin_office on portal_acceptances
  for select to authenticated
  using (current_app_role() in ('admin','office'));

------------------------------------------------------------------------------
-- 3. Audit triggers (audit_whs from 0010 — INSERT stores summary fields only,
--    never the signature payload)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['portal_requests','portal_acceptances'] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

-- REQ numbering.
insert into sequences (key, next_value) values ('portal_request', 1)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 4. portal_resolve_link — expose show_financials so the portal knows whether
--    to render the Billing tab (server still re-checks in portal_billing)
------------------------------------------------------------------------------

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
    'client_name', v_client_name,
    'label', l.label,
    'company_name', coalesce(s.company_name, 'Entice'),
    'logo_path', s.logo_path,
    'company_phone', s.phone,
    'company_email', s.email,
    'company_address', s.address,
    'company_abn', s.abn,
    'show_financials', l.show_financials);
end $$;

------------------------------------------------------------------------------
-- 5. Correspondence fns
------------------------------------------------------------------------------

-- Client posts a message on one of their own properties. Rate limit: 20
-- client messages per rolling hour per link. Returns:
--   null                       dead token or site outside the client's scope
--   {'error':'invalid'}        bad arguments
--   {'error':'rate_limited'}   over the hourly cap
--   {'ok':true}                stored
create function portal_post_message(
  p_token text, p_site uuid, p_name text, p_body text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_name text := left(trim(coalesce(p_name, '')), 120);
  v_body text := trim(coalesce(p_body, ''));
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if v_name = '' or v_body = '' or char_length(v_body) > 2000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if (select count(*) from portal_messages
       where client_link_id = l.id
         and sender = 'client'
         and created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into portal_messages
    (client_id, site_id, client_link_id, sender, sender_name, body,
     read_by_client, read_by_office)
  values (l.client_id, p_site, l.id, 'client', v_name, v_body, true, false);

  return jsonb_build_object('ok', true);
end $$;

-- The thread for one property, oldest first. Marks office messages as read by
-- the client (hence volatile). Office sender names come from profiles.
create function portal_thread(p_token text, p_site uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_thread jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  update portal_messages
     set read_by_client = true
   where client_id = l.client_id and site_id = p_site
     and sender = 'office' and not read_by_client;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'sender', m.sender,
      'sender_name', case when m.sender = 'office'
        then coalesce(pr.full_name, 'Office') else m.sender_name end,
      'body', m.body,
      'created_at', m.created_at)
      order by m.created_at, m.id), '[]'::jsonb)
    into v_thread
    from portal_messages m
    left join profiles pr on pr.id = m.sender_profile_id
   where m.client_id = l.client_id and m.site_id = p_site;

  return v_thread;
end $$;

------------------------------------------------------------------------------
-- 6. Work request fns
------------------------------------------------------------------------------

-- Client submits a work request against one of their properties. Rate limit:
-- 10 per rolling 24h per link. Photo paths must sit under this link's own
-- upload prefix (portal-requests/<link id>/…) — you cannot attach another
-- link's uploads. Returns {'ok':true,'number':'REQ-0001'} on success.
create function portal_submit_request(
  p_token text, p_site uuid, p_title text, p_description text,
  p_urgency text, p_photo_paths text[] default '{}'
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
     urgency, photo_paths)
  values (v_number, l.client_id, p_site, l.id, v_title, v_desc,
          p_urgency, v_paths)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'number', v_number, 'id', v_id);
end $$;

-- The client's own requests (optionally one property), newest first. Status
-- only — never quote amounts or office notes.
create function portal_my_requests(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'number', r.number,
      'site_id', r.site_id,
      'site_name', s.name,
      'title', r.title,
      'description', r.description,
      'urgency', r.urgency,
      'status', r.status,
      'photo_count', coalesce(array_length(r.photo_paths, 1), 0),
      'created_at', r.created_at)
      order by r.created_at desc)
    from portal_requests r
    join sites s on s.id = r.site_id
    where r.client_id = l.client_id
      and (p_site is null or r.site_id = p_site)
  ), '[]'::jsonb);
end $$;

-- Upload gate for request photos: validates the token, rate-limits uploads
-- (40 per rolling 24h per link, logged through portal_views) and hands the
-- route the link id that prefixes the storage path. The route enforces
-- size/type/count on the files themselves.
create function portal_register_upload(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if (select count(*) from portal_views
       where client_link_id = l.id
         and path = 'upload:portal-request-photo'
         and viewed_at > now() - interval '24 hours') >= 40 then
    return jsonb_build_object('allowed', false);
  end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, null, 'upload:portal-request-photo');

  return jsonb_build_object('allowed', true, 'link_id', l.id);
end $$;

------------------------------------------------------------------------------
-- 7. Approval fns (sign on the glass)
------------------------------------------------------------------------------

-- Published quotes/variations for this client. DELIBERATE exception to the
-- portal's no-money rule: an approval needs its number and total — and ONLY
-- that. Quote amount = total inc GST (what the client-facing PDF shows);
-- variation amount = sell_amount ex GST (contract adjustment). No costs,
-- margins or budgets, ever.
--   {'pending':[…], 'decided':[…]} — pending items are signable now; decided
--   items were accepted/declined through the portal (display only).
create function portal_approvals(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_pending jsonb;
  v_decided jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  with quote_items as (
    select 'quote' as kind, q.id, q.number, q.title,
           s.name as context, q.site_id,
           (select round(coalesce(sum(round(ql.qty * ql.unit_sell, 2)), 0)
                   * (1 + q.gst_rate / 100), 2)
              from quote_lines ql where ql.quote_id = q.id) as amount,
           true as gst_inclusive,
           to_char(coalesce(q.sent_at, q.created_at) at time zone 'Australia/Brisbane',
                   'YYYY-MM-DD') as item_date,
           q.status, 'sent' as signable_status
    from quotes q
    left join sites s on s.id = q.site_id
    where q.client_id = l.client_id
      and q.portal_published
      and (p_site is null or q.site_id = p_site)
  ),
  variation_items as (
    select 'variation' as kind, v.id,
           'VO-' || v.number::text as number, v.title,
           p.number || ' — ' || p.name as context, p.site_id,
           v.sell_amount as amount,
           false as gst_inclusive,
           to_char(coalesce(v.submitted_at, v.created_at) at time zone 'Australia/Brisbane',
                   'YYYY-MM-DD') as item_date,
           v.status, 'submitted' as signable_status
    from variations v
    join projects p on p.id = v.project_id
    where p.client_id = l.client_id
      and v.portal_published
      and (p_site is null or p.site_id = p_site)
  ),
  items as (
    select * from quote_items union all select * from variation_items
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
        'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
        'gst_inclusive', i.gst_inclusive, 'date', i.item_date)
        order by i.item_date desc, i.number)
      from items i
      where i.status = i.signable_status
        and not exists (select 1 from portal_acceptances a
                         where a.kind = i.kind and a.target_id = i.id)
    ), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
        'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
        'gst_inclusive', i.gst_inclusive, 'date', i.item_date,
        'action', a.action, 'signer_name', a.signer_name,
        'signed_on', to_char(a.signed_at at time zone 'Australia/Brisbane',
                             'YYYY-MM-DD'))
        order by a.signed_at desc)
      from items i
      join lateral (
        select * from portal_acceptances a
        where a.kind = i.kind and a.target_id = i.id
        order by a.action = 'accepted' desc, a.signed_at desc
        limit 1
      ) a on true
    ), '[]'::jsonb)
  into v_pending, v_decided;

  return jsonb_build_object('pending', v_pending, 'decided', v_decided);
end $$;

-- Entitlement check + view log for the portal PDF proxy. Null unless the
-- item is published and belongs to this client (pending or already decided —
-- clients may re-open what they signed).
create function portal_approval_file(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_number text;
  v_site uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind = 'quote' then
    select q.number, q.site_id into v_number, v_site
      from quotes q
     where q.id = p_id and q.client_id = l.client_id
       and q.portal_published and q.status in ('sent','accepted');
  elsif p_kind = 'variation' then
    select 'VO-' || v.number::text, p.site_id into v_number, v_site
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id
       and v.portal_published and v.status in ('submitted','approved');
  end if;

  if v_number is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:approval:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('number', v_number);
end $$;

-- Accept: flips the target with the SAME transition the office uses
-- (quote sent→accepted / variation submitted→approved, decided_at = now()),
-- atomically status-guarded, and records the signature evidence. Returns:
--   null                        dead token / not entitled / not published
--   {'error':'invalid'}         bad signer/signature payload
--   {'error':'not_acceptable'}  wrong status or already decided
--   {'ok':true,'number':…}      done
create function portal_accept(
  p_token text, p_kind text, p_id uuid,
  p_signer_name text, p_signature text, p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_signer text := left(trim(coalesce(p_signer_name, '')), 120);
  v_number text;
  v_client uuid;
  v_ip inet;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind not in ('quote','variation') then return null; end if;

  if v_signer = ''
     or coalesce(p_signature, '') not like 'data:image/png;base64,%'
     or char_length(p_signature) > 140000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  begin
    v_ip := nullif(trim(coalesce(p_ip, '')), '')::inet;
  exception when others then
    v_ip := null;
  end;

  if p_kind = 'quote' then
    select q.number, q.client_id into v_number, v_client
      from quotes q
     where q.id = p_id and q.client_id = l.client_id and q.portal_published;
    if v_number is null then return null; end if;

    -- Atomic status guard — mirrors setQuoteStatus (sent → accepted).
    update quotes set status = 'accepted', decided_at = now()
     where id = p_id and status = 'sent';
    if not found then return jsonb_build_object('error', 'not_acceptable'); end if;
  else
    select 'VO-' || v.number::text, p.client_id into v_number, v_client
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id and v.portal_published;
    if v_number is null then return null; end if;

    -- Atomic status guard — mirrors setVariationStatus (submitted → approved).
    update variations set status = 'approved', decided_at = now()
     where id = p_id and status = 'submitted';
    if not found then return jsonb_build_object('error', 'not_acceptable'); end if;
  end if;

  insert into portal_acceptances
    (kind, target_id, client_id, client_link_id, action, signer_name,
     signature_data, ip)
  values (p_kind, p_id, v_client, l.id, 'accepted', v_signer, p_signature, v_ip);

  return jsonb_build_object('ok', true, 'number', v_number);
end $$;

-- Decline: records the reason for office attention. The target's status is
-- NOT changed — office follows up (may republish, revise or mark lost/rejected
-- through the normal office actions).
create function portal_decline(
  p_token text, p_kind text, p_id uuid, p_signer_name text, p_reason text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_signer text := left(trim(coalesce(p_signer_name, '')), 120);
  v_reason text := trim(coalesce(p_reason, ''));
  v_client uuid;
  v_number text;
  v_status text;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind not in ('quote','variation') then return null; end if;

  if v_signer = '' or v_reason = '' or char_length(v_reason) > 1000 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if p_kind = 'quote' then
    select q.number, q.client_id, q.status into v_number, v_client, v_status
      from quotes q
     where q.id = p_id and q.client_id = l.client_id and q.portal_published;
  else
    select 'VO-' || v.number::text, p.client_id, v.status
      into v_number, v_client, v_status
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id and v.portal_published;
  end if;
  if v_number is null then return null; end if;

  -- Only pending items can be declined, and only once (accept wins).
  if (p_kind = 'quote' and v_status <> 'sent')
     or (p_kind = 'variation' and v_status <> 'submitted')
     or exists (select 1 from portal_acceptances a
                 where a.kind = p_kind and a.target_id = p_id) then
    return jsonb_build_object('error', 'not_acceptable');
  end if;

  insert into portal_acceptances
    (kind, target_id, client_id, client_link_id, action, signer_name, reason)
  values (p_kind, p_id, v_client, l.id, 'declined', v_signer, v_reason);

  return jsonb_build_object('ok', true, 'number', v_number);
end $$;

------------------------------------------------------------------------------
-- 8. Billing (gated financial history)
------------------------------------------------------------------------------

-- Issued invoices (site's jobs) and claims (site's projects) — number, date,
-- amount, status. Null unless the link's show_financials flag is ON. Drafts
-- and voids never appear.
create function portal_billing(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or not l.show_financials then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  return coalesce((
    select jsonb_agg(row_j order by row_j->>'date' desc, row_j->>'number')
    from (
      select jsonb_build_object(
        'kind', 'invoice',
        'number', i.number,
        'context', j.number || ' — ' || j.title,
        'date', i.issue_date,
        'amount', (select round(coalesce(sum(round(il.qty * il.unit_sell, 2)), 0)
                          * (1 + i.gst_rate / 100), 2)
                     from invoice_lines il where il.invoice_id = i.id),
        'status', i.status) as row_j
      from invoices i
      join jobs j on j.id = i.job_id and j.site_id = p_site
      where i.client_id = l.client_id
        and i.status in ('sent','paid')

      union all

      select jsonb_build_object(
        'kind', 'claim',
        'number', p.number || ' · Claim ' || c.number::text,
        'context', p.number || ' — ' || p.name,
        'date', c.reference_date,
        'amount', c.total_inc_gst,
        'status', c.status) as row_j
      from claims c
      join projects p on p.id = c.project_id
        and p.site_id = p_site and p.client_id = l.client_id
      where c.status in ('submitted','certified','paid')
    ) rows
  ), '[]'::jsonb);
end $$;

------------------------------------------------------------------------------
-- 9. Grants — the anon portal consumes ONLY these functions
------------------------------------------------------------------------------

grant execute on function portal_post_message(text, uuid, text, text) to anon, authenticated;
grant execute on function portal_thread(text, uuid) to anon, authenticated;
grant execute on function portal_submit_request(text, uuid, text, text, text, text[]) to anon, authenticated;
grant execute on function portal_my_requests(text, uuid) to anon, authenticated;
grant execute on function portal_register_upload(text) to anon, authenticated;
grant execute on function portal_approvals(text, uuid) to anon, authenticated;
grant execute on function portal_approval_file(text, text, uuid) to anon, authenticated;
grant execute on function portal_accept(text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function portal_decline(text, text, uuid, text, text) to anon, authenticated;
grant execute on function portal_billing(text, uuid) to anon, authenticated;
