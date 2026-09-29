# Job & project P&L — design

**Date:** 2026-09-29 · **Status:** approved by owner in chat

## Goal

See the running profit & loss on every job and project: the price (carried over
from the accepted quote and stored), minus actual recorded cost, giving margin
and % drawdown as the work goes on. Costs = approved clock on/off hours plus any
cost line the office adds at any time (labour hours × rate, plant/equipment,
consumables, subbies, anything else).

## Decisions (owner)

- Scope: **jobs and projects**, one shared P&L panel.
- Timesheet labour: **approved entries only**, cost rate **locked at approval**
  from `profiles.hourly_cost`. Unapproved / still-open hours are shown as
  "pending" and not counted. Hours = clock on → clock off **in full** (no break
  deduction).
- Manual labour lines can be added after the fact (worker from staff list or a
  typed name, hours, rate prefilled from the worker and editable). They are
  costing-only — they do not create timesheet entries.
- Job price: quote sell subtotal (ex GST) stored on the job at conversion, fixed;
  changes go through a **price adjustments log** (+/− with description).
  Existing converted jobs are **backfilled**. Jobs with no quote can have their
  base price set by hand. Projects keep `contract_sum` + approved variations.
- Only **actual recorded cost** counts. No POs, commitments or forecasts in the
  P&L.

## Data — migration 0066

- `jobs.contract_price numeric(14,2)` (ex GST, nullable). Backfill: for jobs with
  a `quote_id` that has lines, sum of `round(qty × unit_sell, 2)`.
- `job_price_adjustments` (new): `id`, `job_id → jobs on delete cascade`,
  `date`, `description`, `amount numeric(14,2)` (non-zero, ±), `created_by`,
  `created_at`. RLS: admin/office all (same as other money tables).
- `costs`: add nullable `hours numeric(8,2)`, `rate numeric(10,2)`,
  `worker_id → profiles`, `worker_name text`. Widen the `source` check to
  `('manual','docket','labour')`. Check: a `labour` row must have hours > 0 and
  rate ≥ 0; `amount` is always stored (= round(hours × rate, 2) for labour).
- `timesheet_entries.cost_rate numeric(10,2)`. Backfill approved entries from
  the current `profiles.hourly_cost`, then a BEFORE INSERT/UPDATE trigger:
  becoming approved → stamp `profiles.hourly_cost`; unapproved → null; staying
  approved → keep the old value unless the caller is admin/office.

## Calculation — `src/lib/pnl.ts` (pure, unit tested)

Input: base price, adjustments (or approved variations), timesheet rows
(start, end, approved, cost_rate, worker), cost rows (amount, source, cost code
category). Output:

- `price` = base + Σ adjustments
- timesheet labour: approved & closed entries → hours × cost_rate, grouped by
  worker; entries with no rate are counted as hours with a "no rate" flag and
  $0 cost; pending hours = unapproved or open (open measured to `now`)
- category breakdown: labour / plant / materials / subcontract / other. A cost
  row's category is its cost code's category, else `labour` for labour rows,
  else `other`. Timesheet labour → labour.
- `cost` = timesheet labour + Σ cost rows; `margin` = price − cost;
  `marginPct` = margin ÷ price; `drawdownPct` = cost ÷ price (null when price
  is 0/absent).

## UI

`<PnlPanel>` (client component), admin/office only:

1. Summary strip: Price · Cost to date · Margin ($, %) · drawdown bar (amber
   > 80 %, red > 100 %).
2. Price: jobs — base price (quote) + adjustments list + "Add adjustment";
   "Set price" when the job has no quote. Projects — contract sum + approved
   variations (read-only, link to Variations tab).
3. Category breakdown.
4. Timesheet labour by worker (read-only) + pending hours line.
5. Cost lines table with Add / Edit / Delete. The add dialog toggles
   **Labour** (worker select or typed name, hours, rate → amount) vs **Other
   cost** (cost code, description, amount). Docket rows are read-only.

Placement: the job page's "Costs" section becomes "Costs & P&L" (same spot,
same `canSeeCosts` gate). Projects get a new money tab **P&L** (`/pnl`). The
Budget tab is unchanged; new cost lines appear in its actuals automatically.

## Server actions — `src/lib/pnl-actions.ts`

admin/office only (`requireRole`), zod-validated, parent-agnostic
(`parent_type` + `parent_id`): `addCostLine`, `updateCostLine`,
`deleteCostLine` (manual/labour rows only; docket rows refused),
`addPriceAdjustment`, `deletePriceAdjustment`, `setJobBasePrice` (refused when
the job has a quote). Conversion (`convertQuoteToJob`) sets `contract_price`
from the quote lines. The old `addJobCost` / `CostsSection` are replaced.

## Out of scope / follow-ups

- Reports → Profitability does not include timesheet labour.
- "Invoice from costs" does not include timesheet labour.
- No UI to edit a locked timesheet cost rate.
