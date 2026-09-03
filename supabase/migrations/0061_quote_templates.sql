-- 0061: quote templates — structured client-facing quote documents imported
-- from an existing PDF (Settings → Quote templates), snapshotted onto quotes.
-- Also the two fields the templated details block needs: client address and
-- staff position ("Prepared by Nicholas Jones | Director").

alter table clients add column address text;
alter table profiles add column position text;

create table quote_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  doc_title text not null default 'Quotation',
  heading text,
  validity_text text not null default '{{quote.valid_days}} days from issue unless otherwise stated',
  number_headings boolean not null default true,
  blocks jsonb not null default '[]'::jsonb,
  pricing_defaults jsonb not null default '{"mode":"itemised","show_qty_unit":true,"list_items":true,"show_gst":true,"fee_label":"Fixed fee"}'::jsonb,
  is_default boolean not null default false,
  active boolean not null default true,
  source_path text,
  source_filename text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One default among the active templates.
create unique index quote_templates_one_default
  on quote_templates (is_default) where is_default and active;

alter table quote_templates enable row level security;
create policy quote_templates_money_select on public.quote_templates
  for select to authenticated using (current_app_role() in ('admin','office'));
create policy quote_templates_admin_insert on public.quote_templates
  for insert to authenticated with check (current_app_role() = 'admin');
create policy quote_templates_admin_update on public.quote_templates
  for update to authenticated
  using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy quote_templates_admin_delete on public.quote_templates
  for delete to authenticated using (current_app_role() = 'admin');

-- Per-quote snapshot: the document travels with the quote, so a template edit
-- never changes a sent quote and the portal proxy needs no template lookup.
alter table quotes add column template_id uuid references quote_templates(id) on delete set null;
alter table quotes add column doc jsonb;
alter table quotes add column pdf_options jsonb;
