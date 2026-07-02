-- 0024_management_review.sql
-- Management Review — ISO 9001/14001/45001 9.3. A structured record of
-- periodic top-management reviews of the integrated QHSE system: each review
-- carries date/period/chair/attendees, the CONTROLLED list of ISO-mandated
-- 9.3.2 inputs (each a RAG status + minute + a frozen jsonb data snapshot
-- auto-pulled from the live registers), and 9.3.3 outputs as dated actions
-- that live on in the tracker after the review closes.
--
-- Conventions follow 0023_objectives_kpis.sql / 0022 / 0021 / 0020:
-- current_app_role() RLS, audit_whs() AFTER triggers (which log new.id, so
-- every table carries a uuid id PK), next_number('mgmt_review') sequence,
-- append-only audit_log.
--
-- Locked decisions implemented here:
--   * Visibility: admin/office/supervisor SELECT only; FIELD HAS NO ACCESS —
--     management-review minutes are commercially sensitive. Writes a/o only;
--     deletes admin-only.
--   * Inputs are a CONTROLLED LIST (CHECK below, mirrored by the app constant
--     in src/lib/mgmt-review.ts) seeded per review at creation — never
--     user-configurable.
--   * Completion guard is SOFT and lives in the server action (close with
--     un-reviewed inputs requires an explicit confirm). It NEVER blocks on
--     open output actions — those are meant to stay open in the tracker.
--   * Closed-review lock (cheap DB belt-and-braces under the server actions):
--     - management_reviews: the only UPDATE allowed while closed is the admin
--       reopen (status moving OFF 'closed').
--     - inputs/attendees: frozen entirely while the parent review is closed
--       (snapshots are evidence — they never refresh after close).
--     - actions: stay updatable after close (the server action restricts a
--       closed review's action updates to status/completed fields only).

------------------------------------------------------------------------------
-- 1. Tables
------------------------------------------------------------------------------

create table management_reviews (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,            -- MR-0001 via next_number('mgmt_review')
  review_date date not null,
  period_covered text,                    -- e.g. 'Jul 2025 – Jun 2026'
  chaired_by uuid references profiles(id),
  status text not null default 'draft' check (status in (
    'draft','in_progress','closed'
  )),
  general_minutes text,
  closed_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index management_reviews_status_idx on management_reviews (status);

create table management_review_inputs (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references management_reviews(id) on delete cascade,
  -- The controlled ISO 9.3.2 input list — one row per key, seeded at review
  -- creation. Mirrors MGMT_REVIEW_INPUT_KEYS in src/lib/mgmt-review.ts.
  input_key text not null check (input_key in (
    'previous_actions_status',
    'context_changes',
    'customer_feedback_complaints',
    'objectives_kpi_performance',
    'process_performance_ncr_trends',
    'incidents_safety_performance',
    'audit_results',
    'risk_opportunity_effectiveness',
    'legal_compliance_status',
    'resource_adequacy',
    'worker_consultation_participation',
    'external_provider_performance',
    'improvement_opportunities'
  )),
  rag text check (rag in ('green','amber','red')), -- null until reviewed
  minute text,
  -- Auto-pulled register snapshot (frozen evidence; null for free-text-only
  -- inputs). The audit trigger logs jsonb 'data' changes as a marker only.
  data jsonb,
  reviewed boolean not null default false,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (review_id, input_key)
);
create index management_review_inputs_review_idx
  on management_review_inputs (review_id);

create table management_review_attendees (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references management_reviews(id) on delete cascade,
  profile_id uuid references profiles(id), -- internal attendee…
  name text,                               -- …or an external's name
  role_title text,
  created_at timestamptz not null default now(),
  check (profile_id is not null or name is not null)
);
create index management_review_attendees_review_idx
  on management_review_attendees (review_id);

-- 9.3.3 outputs: decisions and actions with owners + due dates. These live on
-- in the tracker after the review closes — never a close blocker.
create table management_review_actions (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references management_reviews(id) on delete cascade,
  description text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index management_review_actions_review_idx
  on management_review_actions (review_id);
create index management_review_actions_status_idx
  on management_review_actions (status);

------------------------------------------------------------------------------
-- 2. Closed-review lock triggers (DB belt-and-braces)
------------------------------------------------------------------------------

-- The only UPDATE allowed on a closed review is the reopen itself (status
-- moving off 'closed' — admin-only, enforced in the server action).
create function mgmt_review_closed_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'closed' and new.status = 'closed' then
    raise exception 'This management review is closed — reopen it to make changes';
  end if;
  return new;
end $$;

revoke execute on function mgmt_review_closed_guard() from anon, authenticated, public;

create trigger management_reviews_closed_guard
  before update on management_reviews
  for each row execute function mgmt_review_closed_guard();

-- Inputs and attendees freeze entirely once the review is closed. When the
-- parent row is already gone (cascade delete of the review itself) the status
-- lookup returns null and the delete proceeds.
create function mgmt_review_child_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_review uuid;
  v_status text;
begin
  if tg_op = 'DELETE' then
    v_review := old.review_id;
  else
    v_review := new.review_id;
  end if;
  select status into v_status from management_reviews where id = v_review;
  if v_status = 'closed' then
    raise exception 'This management review is closed — its inputs and attendees are frozen';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

revoke execute on function mgmt_review_child_guard() from anon, authenticated, public;

create trigger management_review_inputs_closed_guard
  before insert or update or delete on management_review_inputs
  for each row execute function mgmt_review_child_guard();

create trigger management_review_attendees_closed_guard
  before insert or update or delete on management_review_attendees
  for each row execute function mgmt_review_child_guard();

------------------------------------------------------------------------------
-- 3. RLS (admin/office full; supervisor SELECT; field none; deletes admin-only)
------------------------------------------------------------------------------

alter table management_reviews          enable row level security;
alter table management_review_inputs    enable row level security;
alter table management_review_attendees enable row level security;
alter table management_review_actions   enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'management_reviews','management_review_inputs',
    'management_review_attendees','management_review_actions'
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
    'management_reviews','management_review_inputs',
    'management_review_attendees','management_review_actions'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function audit_whs()',
      t || '_audit', t);
  end loop;
end $$;

------------------------------------------------------------------------------
-- 5. Sequence: review numbering (MR-0001 via next_number('mgmt_review'))
------------------------------------------------------------------------------

-- No seeded reviews: management reviews are REAL evidence — a fabricated MR
-- is worse than none. The 13 input definitions live in code
-- (src/lib/mgmt-review.ts) and are seeded per review at creation. The
-- Management Review Procedure already exists in the controlled document
-- register (INT-PRO-003) — referenced, not duplicated.
insert into sequences (key, next_value) values ('mgmt_review', 1)
on conflict (key) do nothing;
