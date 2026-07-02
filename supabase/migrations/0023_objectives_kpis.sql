-- 0023_objectives_kpis.sql
-- Objectives & KPIs — ISO 9001/14001/45001 6.2 (objectives) + 9.1 (monitoring,
-- measurement, analysis, evaluation). A central register of management
-- objectives, each with a measurable target + named KPI tracked
-- period-by-period. Actuals come from MANUAL entry OR AUTO derivation via the
-- single server-side metrics engine (src/lib/kpi-metrics.ts) — one source per
-- objective, never mixed.
--
-- Conventions follow 0022_risk_register.sql / 0021 / 0020: current_app_role()
-- RLS, audit_whs() AFTER triggers, next_number('objective') sequence,
-- append-only audit_log.
--
-- Locked decisions implemented here:
--   * LTIFR hours-worked source is MANUAL monthly entry (company_hours) — the
--     office enters the payroll hours figure per month. Hours are NEVER
--     derived from field check-ins.
--   * One source per objective: source ∈ (manual|auto); auto_metric_key is
--     required iff source = 'auto' (CHECK below). The kpi_values entry guard
--     trigger additionally enforces at the DB that a manually-entered value
--     (entered_by set) can never land on an auto objective and vice versa.
--   * Direction-aware targets: direction ∈ (at_most|at_least). Traffic-light
--     derivation (on_track / at_risk / off_track) is pure TS in
--     src/lib/objectives.ts.
--   * Auto kpi_values are recomputed (UPSERT); the audit_whs() trigger records
--     every insert/update — that IS the evidence trail, no extra locking.
--   * company_hours has a uuid id (audit_whs() logs new.id); period_key is
--     UNIQUE and is the business key ('YYYY-MM').

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table objectives (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,           -- OBJ-0001 via next_number('objective')
  title text not null,
  description text,
  iso_domain text not null check (iso_domain in (
    'quality','environmental','ohs','multi'
  )),
  metric_name text not null,             -- e.g. 'LTIFR', 'On-time delivery'
  unit text not null,                    -- count, %, rate, score, …
  target_value numeric not null,
  -- Target semantics: at_most = lower is better (LTIFR, NCR count);
  -- at_least = higher is better (% / score targets).
  direction text not null check (direction in ('at_most','at_least')),
  period text not null check (period in ('monthly','quarterly')),
  source text not null check (source in ('manual','auto')),
  auto_metric_key text,                  -- key into the TS AUTO_METRICS registry
  check ((source = 'auto') = (auto_metric_key is not null)),
  owner_id uuid references profiles(id),
  status text not null default 'active' check (status in (
    'active','achieved','retired'
  )),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index objectives_status_idx on objectives (status);
create index objectives_source_idx on objectives (source);

create table kpi_values (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  -- 'YYYY-MM' for monthly objectives, 'YYYY-Qn' for quarterly (AU calendar).
  period_key text not null check (period_key ~ '^\d{4}-((0[1-9]|1[0-2])|Q[1-4])$'),
  value numeric not null,
  note text,
  entered_by uuid references profiles(id), -- null = auto-derived by the engine
  computed_at timestamptz not null default now(),
  unique (objective_id, period_key)
);
create index kpi_values_objective_idx on kpi_values (objective_id);

-- The manual monthly hours-worked feed for LTIFR (payroll number).
create table company_hours (
  id uuid primary key default gen_random_uuid(),
  period_key text not null unique check (period_key ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  hours numeric not null check (hours >= 0),
  entered_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);

-- Improvement actions raised when an objective runs off-track.
create table objective_actions (
  id uuid primary key default gen_random_uuid(),
  objective_id uuid not null references objectives(id) on delete cascade,
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index objective_actions_objective_idx on objective_actions (objective_id);
create index objective_actions_status_idx on objective_actions (status);

------------------------------------------------------------------------------
-- 2. kpi_values entry guard — DB enforcement of "one source per objective"
------------------------------------------------------------------------------

-- Belt-and-braces under the server-action guard: an AUTO objective can only
-- carry engine-computed rows (entered_by null); a MANUAL objective can only
-- carry attributed rows (entered_by set). Also pins the period_key shape to
-- the parent objective's period.
create function kpi_value_entry_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_source text;
  v_period text;
begin
  select source, period into v_source, v_period
  from objectives where id = new.objective_id;

  if v_source = 'auto' and new.entered_by is not null then
    raise exception 'manual entry is not allowed on an auto-derived objective';
  end if;
  if v_source = 'manual' and new.entered_by is null then
    raise exception 'values for a manual objective must record who entered them';
  end if;
  if v_period = 'monthly' and new.period_key !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'monthly objectives require a YYYY-MM period key';
  end if;
  if v_period = 'quarterly' and new.period_key !~ '^\d{4}-Q[1-4]$' then
    raise exception 'quarterly objectives require a YYYY-Qn period key';
  end if;
  return new;
end $$;

revoke execute on function kpi_value_entry_guard() from anon, authenticated, public;

create trigger kpi_values_entry_guard
  before insert or update on kpi_values
  for each row execute function kpi_value_entry_guard();

------------------------------------------------------------------------------
-- 3. RLS (admin/office full; supervisor SELECT; field none; deletes admin-only)
------------------------------------------------------------------------------

alter table objectives        enable row level security;
alter table kpi_values        enable row level security;
alter table company_hours     enable row level security;
alter table objective_actions enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'objectives','kpi_values','company_hours','objective_actions'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (current_app_role() in (''admin'',''office'',''supervisor''))',
      t || '_select_staff', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (current_app_role() in (''admin'',''office''))',
      t || '_insert_admin_office', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (current_app_role() in (''admin'',''office''))
         with check (current_app_role() in (''admin'',''office''))',
      t || '_update_admin_office', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (current_app_role() = ''admin'')',
      t || '_delete_admin', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 4. Audit triggers (reuse audit_whs() from 0010_whs.sql — immutable trail)
------------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'objectives','kpi_values','company_hours','objective_actions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: objective numbering (OBJ-0001 via next_number('objective'))
------------------------------------------------------------------------------

-- Starts at 10 — the nine seeded objectives below consume OBJ-0001…OBJ-0009.
insert into sequences (key, next_value) values ('objective', 10)
on conflict (key) do nothing;

------------------------------------------------------------------------------
-- 6. Seed — starter objectives across all three standards
--    (idempotent, stable UUIDs, Rev A — review before adoption)
------------------------------------------------------------------------------

insert into objectives
  (id, number, title, description, iso_domain, metric_name, unit,
   target_value, direction, period, source, auto_metric_key, status)
values
  ('fa100000-0000-4000-a000-000000000001', 'OBJ-0001',
   'Zero lost-time injuries',
   'Lost Time Injury Frequency Rate — lost-time injuries per million hours worked. Hours come from the manual monthly company-hours entry (payroll figure); lost-time injuries are injury incidents of severity 3 or higher. Rev A — review before adoption.',
   'ohs', 'LTIFR', 'rate', 0, 'at_most', 'monthly', 'auto', 'ltifr', 'active'),

  ('fa100000-0000-4000-a000-000000000002', 'OBJ-0002',
   'Zero environmental incidents',
   'Environmental incidents recorded in the incident register per month. Target zero — any environmental release or breach is investigated. Rev A — review before adoption.',
   'environmental', 'Environmental incidents', 'count', 0, 'at_most', 'monthly',
   'auto', 'environmental_incident_count', 'active'),

  ('fa100000-0000-4000-a000-000000000003', 'OBJ-0003',
   'Keep nonconformances low and visible',
   'NCRs raised per month across all sources. A monitoring objective — the target is a ceiling of 3/month; a spike signals a process problem to investigate, not a reason to stop raising NCRs. Rev A — review before adoption.',
   'quality', 'NCRs raised', 'count', 3, 'at_most', 'monthly', 'auto',
   'ncr_count', 'active'),

  ('fa100000-0000-4000-a000-000000000004', 'OBJ-0004',
   'Close corrective actions on time',
   'Of the CAPA actions completed in the month, the percentage completed on or before their due date. Actions without a due date are excluded. Rev A — review before adoption.',
   'quality', 'CAPA on-time close', '%', 90, 'at_least', 'monthly', 'auto',
   'capa_on_time_close_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000005', 'OBJ-0005',
   'Deliver projects on programme',
   'Of the projects whose programme finished in the quarter (all tasks 100% complete), the percentage whose actual finish (latest task end date) was on or before the baseline programme end. Requires a baseline to be set. Rev A — review before adoption.',
   'quality', 'On-time delivery', '%', 95, 'at_least', 'quarterly', 'auto',
   'on_time_delivery_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000006', 'OBJ-0006',
   'Keep worker competencies current',
   'Percentage of (active worker × mandatory role requirement) pairs with a current competency record. Snapshot of the register as at the refresh — only the current period is computed; history accrues as each month is refreshed. Rev A — review before adoption.',
   'multi', 'Training compliance', '%', 95, 'at_least', 'monthly', 'auto',
   'training_compliance_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000007', 'OBJ-0007',
   'Close internal audits promptly',
   'Of the internal audits closed in the quarter, the percentage closed within 30 days of their planned date. Audits without a planned date are excluded. Rev A — review before adoption.',
   'multi', 'Audit on-time close', '%', 90, 'at_least', 'quarterly', 'auto',
   'audit_on_time_close_pct', 'active'),

  ('fa100000-0000-4000-a000-000000000008', 'OBJ-0008',
   'Keep clients happy',
   'Average customer satisfaction score out of 5 from post-project client feedback, entered quarterly by the office. Rev A — review before adoption.',
   'quality', 'Customer satisfaction', 'score', 4.5, 'at_least', 'quarterly',
   'manual', null, 'active'),

  ('fa100000-0000-4000-a000-000000000009', 'OBJ-0009',
   'Recycle site waste',
   'Percentage of waste (by tonnage) leaving site that goes to recycling or beneficial reuse rather than landfill, entered quarterly from waste dockets. Auto-derivation arrives with the environmental module. Rev A — review before adoption.',
   'environmental', 'Waste recycled', '%', 80, 'at_least', 'quarterly',
   'manual', null, 'active')
on conflict do nothing;

-- 2–3 months of company hours (~15-person crew ≈ 4,000 h/month) so LTIFR
-- computes on the first refresh. The current month is deliberately absent —
-- LTIFR stays null (not 0) until the payroll figure is entered.
insert into company_hours (id, period_key, hours) values
  ('fa200000-0000-4000-a000-000000000001', '2026-04', 3900),
  ('fa200000-0000-4000-a000-000000000002', '2026-05', 4200),
  ('fa200000-0000-4000-a000-000000000003', '2026-06', 4050)
on conflict do nothing;
