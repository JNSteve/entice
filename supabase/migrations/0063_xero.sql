-- 0063: Xero integration (two-way invoicing over OAuth 2.0).
--   * xero_connection — singleton, encrypted tokens, NO RLS policies (service role only).
--   * invoices/claims/payments/clients/jobs/projects — Xero link columns.
--   * invoice_lines.kind — drives the income-account mapping (RATE_KINDS values).
--   * Reference caches (accounts, tax rates, tracking, contacts) — admin/office read.
--   * settings.xero_* — account/tax/tracking mapping + email mode.
--   * xero_sync_runs / xero_sync_events — the register (admin/office read, never pruned).
--   * portal_billing — adds pay_url (Xero online invoice) for invoices.
-- Design: docs/superpowers/specs/2026-09-05-xero-integration-design.md

------------------------------------------------------------------------------
-- 1. Connection singleton — service role only
------------------------------------------------------------------------------
create table xero_connection (
  id int primary key default 1 check (id = 1),
  tenant_id text,
  tenant_name text,
  connection_id text,
  access_token_enc text,            -- AES-256-GCM "iv.ct.tag" (base64url parts)
  refresh_token_enc text,
  access_expires_at timestamptz,
  scopes text,
  status text not null default 'disconnected'
    check (status in ('connected','needs_reconnect','disconnected')),
  connected_by uuid references profiles(id),
  connected_at timestamptz,
  last_refresh_at timestamptz,
  last_sync_at timestamptz,
  last_sync_status text,
  updated_at timestamptz not null default now()
);
insert into xero_connection (id) values (1);
alter table xero_connection enable row level security;
-- Intentionally NO policies: tokens are secrets. Only the service role reads/writes.

------------------------------------------------------------------------------
-- 2. Link columns
------------------------------------------------------------------------------
alter table invoices
  add column origin text not null default 'ecr' check (origin in ('ecr','xero')),
  add column xero_invoice_id text unique,
  add column xero_number text,
  add column xero_status text,
  add column xero_total numeric(14,2),
  add column xero_amount_paid numeric(14,2),
  add column xero_amount_credited numeric(14,2),
  add column xero_amount_due numeric(14,2),
  add column xero_online_url text,
  add column xero_pushed_at timestamptz,
  add column xero_emailed_at timestamptz,
  add column xero_synced_at timestamptz,
  add column needs_review boolean not null default false;

alter table invoice_lines
  add column kind text check (kind in ('labour','plant','material','subbie','other'));

alter table claims
  add column xero_invoice_id text unique,
  add column xero_status text,
  add column xero_amount_due numeric(14,2),
  add column xero_online_url text,
  add column xero_pushed_at timestamptz,
  add column xero_emailed_at timestamptz,
  add column xero_synced_at timestamptz;

alter table payments
  add column xero_payment_id text unique,
  add column source text not null default 'ecr' check (source in ('ecr','xero'));

alter table clients  add column xero_contact_id text unique;
alter table jobs     add column xero_tracking_option_id text;
alter table projects add column xero_tracking_option_id text;

-- The pull matches mirrored invoices to work by tracking option, and the
-- nightly hygiene pass asks which options are still in use.
create index jobs_xero_tracking_idx on jobs (xero_tracking_option_id) where xero_tracking_option_id is not null;
create index projects_xero_tracking_idx on projects (xero_tracking_option_id) where xero_tracking_option_id is not null;

------------------------------------------------------------------------------
-- 3. Reference caches — admin/office read, service-role writes
------------------------------------------------------------------------------
create table xero_accounts (
  code text primary key,
  name text not null,
  type text not null,
  tax_type text,
  status text,
  synced_at timestamptz not null default now()
);
create table xero_tax_rates (
  tax_type text primary key,
  name text not null,
  effective_rate numeric(6,3),
  status text,
  synced_at timestamptz not null default now()
);
create table xero_tracking_categories (
  id text primary key,
  name text not null,
  status text,
  synced_at timestamptz not null default now()
);
create table xero_tracking_options (
  id text primary key,
  category_id text not null references xero_tracking_categories(id) on delete cascade,
  name text not null,
  status text,
  synced_at timestamptz not null default now()
);
-- Spec §3: contacts cache holds ONLY id, name, ABN and whether an email exists.
create table xero_contacts (
  contact_id text primary key,
  name text not null,
  abn text,
  has_email boolean not null default false,
  status text,
  synced_at timestamptz not null default now()
);

alter table xero_accounts            enable row level security;
alter table xero_tax_rates           enable row level security;
alter table xero_tracking_categories enable row level security;
alter table xero_tracking_options    enable row level security;
alter table xero_contacts            enable row level security;

create policy xero_accounts_select on xero_accounts
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_tax_rates_select on xero_tax_rates
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_tracking_categories_select on xero_tracking_categories
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_tracking_options_select on xero_tracking_options
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_contacts_select on xero_contacts
  for select to authenticated using (current_app_role() in ('admin','office'));
-- No write policies: the sync writes with the service role.

------------------------------------------------------------------------------
-- 4. Settings mapping
------------------------------------------------------------------------------
alter table settings
  add column xero_email_mode text not null default 'xero'
    check (xero_email_mode in ('xero','ecr')),
  add column xero_default_account text,
  add column xero_account_by_kind jsonb not null default '{}'::jsonb,
  add column xero_claims_account text,
  add column xero_gst_tax_type text not null default 'OUTPUT',
  add column xero_no_gst_tax_type text not null default 'EXEMPTOUTPUT',
  add column xero_tracking_category_id text;

------------------------------------------------------------------------------
-- 5. Register — admin/office read, service-role writes, never pruned
------------------------------------------------------------------------------
create table xero_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running','success','partial','failed')),
  trigger text not null check (trigger in ('cron','manual','push')),
  invoices_pulled int not null default 0,
  invoices_created int not null default 0,
  payments_upserted int not null default 0,
  contacts_linked int not null default 0,
  pushed int not null default 0,
  warnings int not null default 0,
  errors int not null default 0,
  error text,
  created_by uuid references profiles(id)
);
create index xero_sync_runs_started_idx on xero_sync_runs (started_at desc);

create table xero_sync_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references xero_sync_runs(id) on delete cascade,
  direction text not null check (direction in ('push','pull')),
  entity text not null
    check (entity in ('invoice','claim','payment','contact','tracking','reference','connection')),
  entity_id uuid,
  xero_id text,
  action text not null
    check (action in ('created','updated','voided','matched','unmatched','archived','skipped','warning','failed')),
  detail text,
  created_at timestamptz not null default now()
);
create index xero_sync_events_run_idx on xero_sync_events (run_id, created_at);
create index xero_sync_events_entity_idx on xero_sync_events (entity, entity_id);

alter table xero_sync_runs   enable row level security;
alter table xero_sync_events enable row level security;
create policy xero_sync_runs_select on xero_sync_runs
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy xero_sync_events_select on xero_sync_events
  for select to authenticated using (current_app_role() in ('admin','office'));
-- No INSERT/UPDATE/DELETE policies for any role.

------------------------------------------------------------------------------
-- 6. portal_billing — 0044 definition + pay_url (invoices only)
------------------------------------------------------------------------------
create or replace function portal_billing(p_token text, p_site uuid) returns jsonb
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
        'id', i.id,
        'number', i.number,
        'context', j.number || ' — ' || j.title,
        'date', i.issue_date,
        'amount', (select round(coalesce(sum(round(il.qty * il.unit_sell, 2)), 0)
                          * (1 + i.gst_rate / 100), 2)
                     from invoice_lines il where il.invoice_id = i.id),
        'status', i.status,
        'pay_url', case when i.status = 'sent' then i.xero_online_url else null end) as row_j
      from invoices i
      join jobs j on j.id = i.job_id and j.site_id = p_site
      where i.client_id = l.client_id
        and i.status in ('sent','paid')

      union all

      select jsonb_build_object(
        'kind', 'claim',
        'id', c.id,
        'number', p.number || ' · Claim ' || c.number::text,
        'context', p.number || ' — ' || p.name,
        'date', c.reference_date,
        'amount', c.total_inc_gst,
        'status', c.status,
        'pay_url', null) as row_j
      from claims c
      join projects p on p.id = c.project_id
        and p.site_id = p_site and p.client_id = l.client_id
      where c.status in ('submitted','certified','paid')
    ) rows
  ), '[]'::jsonb);
end $$;
