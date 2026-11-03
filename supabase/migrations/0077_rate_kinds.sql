-- 0077: rate_kinds — owner-defined rate categories.
--
-- Why: rate items, quote lines and invoice lines carried a fixed set of kinds
-- (labour, plant, material, consumable, subbie, other) enforced by a check
-- constraint on each table. The owner wants to add their own (waste disposal,
-- permits & fees, air monitoring, …) from Settings → Rates → Categories.
--
-- The six built-ins are seeded with builtin = true: their keys stay fixed
-- because code maps them to P&L cost categories and Xero accounts, and they
-- cannot be deleted. Their labels may be renamed. A custom category is deleted
-- only while nothing references it — the foreign keys below (default
-- "no action") refuse the delete otherwise; the app turns that into a message.

create table rate_kinds (
  key        text primary key,
  label      text not null,
  builtin    boolean not null default false,
  created_at timestamptz not null default now(),
  constraint rate_kinds_key_check   check (key ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),
  constraint rate_kinds_label_check check (length(btrim(label)) between 1 and 40)
);

comment on table rate_kinds is
  'Rate categories (kinds) for rate_items / quote_lines / invoice_lines. Built-ins are fixed keys the code depends on; the owner adds custom ones in Settings → Rates.';

alter table rate_kinds enable row level security;

create policy rate_kinds_select_authenticated on rate_kinds
  for select to authenticated
  using (auth.uid() is not null);

create policy rate_kinds_write_admin on rate_kinds
  for all to authenticated
  using (current_app_role() = 'admin')
  with check (current_app_role() = 'admin');

insert into rate_kinds (key, label, builtin) values
  ('labour',     'Labour',            true),
  ('plant',      'Plant & equipment', true),
  ('material',   'Materials',         true),
  ('consumable', 'Consumables',       true),
  ('subbie',     'Subcontract',       true),
  ('other',      'Other',             true);

-- The check constraints become foreign keys. ON UPDATE CASCADE keeps lines in
-- step should a key ever be changed by hand; deletes are refused while in use.
alter table rate_items drop constraint if exists rate_items_kind_check;
alter table rate_items add constraint rate_items_kind_fkey
  foreign key (kind) references rate_kinds(key) on update cascade;

alter table quote_lines drop constraint if exists quote_lines_kind_check;
alter table quote_lines add constraint quote_lines_kind_fkey
  foreign key (kind) references rate_kinds(key) on update cascade;

alter table invoice_lines drop constraint if exists invoice_lines_kind_check;
alter table invoice_lines add constraint invoice_lines_kind_fkey
  foreign key (kind) references rate_kinds(key) on update cascade;

insert into supabase_migrations.schema_migrations (version, name, statements) values
  ('20261103090000', '0077_rate_kinds', array['see supabase/migrations/0077_rate_kinds.sql'])
on conflict (version) do nothing;
