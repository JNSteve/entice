-- Takeoff & estimating: measured/extracted quantities per quote, mapped to
-- the rate library and pushed into quote lines. Money-adjacent — admin/office
-- only, like the quotes tables.

create table takeoff_sheets (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  attachment_id uuid not null references attachments(id) on delete cascade,
  name text not null,
  page int not null default 1,
  -- metres per PDF point at this sheet's page; null until calibrated
  scale_m_per_pt numeric,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index takeoff_sheets_quote_idx on takeoff_sheets (quote_id, created_at);

create table takeoff_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  sheet_id uuid references takeoff_sheets(id) on delete set null,
  source text not null default 'manual'
    check (source in ('measured','manual','report','assembly')),
  shape text check (shape in ('area','line','count')),
  geometry jsonb,
  deduction boolean not null default false,
  color text,
  description text not null,
  qty numeric(14,3) not null default 0,
  unit text not null default 'ea',
  rate_item_id uuid references rate_items(id),
  unit_cost numeric(12,2),
  markup_pct numeric(6,2),
  section_title text,
  notes text,
  group_id uuid,
  position int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index takeoff_items_quote_idx on takeoff_items (quote_id, position);
create index takeoff_items_sheet_idx on takeoff_items (sheet_id) where sheet_id is not null;

-- Assemblies: one unit of the assembly explodes into component quantities.
create table takeoff_assemblies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit text not null default 'm2',
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table takeoff_assembly_components (
  id uuid primary key default gen_random_uuid(),
  assembly_id uuid not null references takeoff_assemblies(id) on delete cascade,
  rate_item_id uuid references rate_items(id),
  description text not null,
  unit text not null default 'ea',
  -- component qty per 1 assembly unit (e.g. 0.5 labour-hours per m2)
  factor numeric(14,4) not null default 1,
  -- OR a flat qty regardless of assembly qty (mobilisation, clearance, ...)
  fixed_qty numeric(14,3),
  position int not null default 0
);
create index takeoff_assembly_components_idx
  on takeoff_assembly_components (assembly_id, position);

-- Provenance: a quote line can point back at the takeoff item it came from.
alter table quote_lines add column takeoff_item_id uuid references takeoff_items(id);

-- RLS: admin/office FOR ALL (money tables pattern).
alter table takeoff_sheets enable row level security;
alter table takeoff_items enable row level security;
alter table takeoff_assemblies enable row level security;
alter table takeoff_assembly_components enable row level security;

create policy takeoff_sheets_office on takeoff_sheets
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy takeoff_items_office on takeoff_items
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy takeoff_assemblies_office on takeoff_assemblies
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));
create policy takeoff_assembly_components_office on takeoff_assembly_components
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

-- Starter assemblies (ECR asbestos work). Components carry NO rate_items —
-- the owner maps rates in Settings -> Estimating; factors are editable
-- defaults, not gospel.
insert into takeoff_assemblies (name, unit, description) values
  ('Class A friable removal — ceiling/wall', 'm2',
   'Explodes m2 into removal labour, encapsulant, waste bags and air monitoring allowance'),
  ('Non-friable AC sheet removal', 'm2',
   'Bonded asbestos cement sheeting — labour, wrap, disposal allowance'),
  ('Asbestos job fixed costs', 'job',
   'Per-job pack: notification admin, decon unit, signage/barricading, clearance inspection');

insert into takeoff_assembly_components (assembly_id, description, unit, factor, fixed_qty, position)
select a.id, c.description, c.unit, coalesce(c.factor, 1), c.fixed_qty, c.position
from takeoff_assemblies a
join (values
  ('Class A friable removal — ceiling/wall', 'Removal labour', 'hr', 0.5::numeric, null::numeric, 0),
  ('Class A friable removal — ceiling/wall', 'Encapsulant/PVA', 'L', 0.3, null, 1),
  ('Class A friable removal — ceiling/wall', '200um waste bags', 'ea', 0.2, null, 2),
  ('Class A friable removal — ceiling/wall', 'Air monitoring shift', 'ea', null, 1, 3),
  ('Non-friable AC sheet removal', 'Removal labour', 'hr', 0.25, null, 0),
  ('Non-friable AC sheet removal', 'Poly wrap 200um', 'm2', 1.2, null, 1),
  ('Non-friable AC sheet removal', 'Disposal allowance (15kg/m2)', 't', 0.015, null, 2),
  ('Asbestos job fixed costs', 'WorkSafe notification admin', 'ea', null, 1, 0),
  ('Asbestos job fixed costs', 'Decon unit supply', 'ea', null, 1, 1),
  ('Asbestos job fixed costs', 'Signage & barricading', 'ea', null, 1, 2),
  ('Asbestos job fixed costs', 'Clearance inspection (LAA)', 'ea', null, 1, 3)
) as c(assembly_name, description, unit, factor, fixed_qty, position)
  on c.assembly_name = a.name;
