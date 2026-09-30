-- 0067: supplier price lists + catalogue-picked job costs.
--   * rate_items gains supplier / product code / notes / updated_at, a
--     'consumable' kind, and 4 dp costs (supplier prices like $5.6525)
--   * costs gains an explicit category, the price-list item it came from,
--     and qty × unit_cost
--   * supplier_import_mappings remembers each supplier's spreadsheet columns

alter table rate_items
  add column supplier text,
  add column product_code text,
  add column notes text,
  add column updated_at timestamptz not null default now();
alter table rate_items alter column cost type numeric(12,4);
alter table rate_items drop constraint if exists rate_items_kind_check;
alter table rate_items add constraint rate_items_kind_check
  check (kind in ('labour','plant','material','consumable','subbie','other'));
create index if not exists rate_items_supplier_code_idx
  on rate_items (lower(supplier), lower(product_code));

alter table costs
  add column category text
    check (category in ('labour','plant','materials','consumables','subcontract','other')),
  add column rate_item_id uuid references rate_items(id) on delete set null,
  add column qty numeric(12,3),
  add column unit_cost numeric(12,4);

create table supplier_import_mappings (
  supplier_key text primary key,
  supplier text not null,
  mapping jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table supplier_import_mappings enable row level security;
create policy supplier_import_mappings_admin_office_all on supplier_import_mappings
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
