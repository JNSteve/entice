# Dashboard job margins — design

**Date:** 2026-09-30 · **Status:** approved by owner in chat
**Builds on:** `2026-09-29-job-project-pnl-design.md` (per-job P&L)

## Goal

A **Job margins** panel on the office dashboard showing live job/project
headroom and closed-out margins, using the same numbers as each job's
Costs & P&L section.

## Decisions (owner)

- One full-width panel with **Live | Closed out** tabs, admin/office only
  (queries never issued for supervisors).
- Closed out window: switch **This FY** (default, 1 Jul–30 Jun, Brisbane dates) /
  **Last 90 days** / **Last FY** / **All time**, remembered in localStorage.
- Closed out includes archived work; Live excludes archived.

## Classification

| | Live | Closed out (closed date) |
|---|---|---|
| Jobs | `scheduled`, `in_progress` | `completed`, `invoiced`, `paid` (`completed_at`, Brisbane date) |
| Projects | `active` | `practical_completion`, `defects_liability`, `closed` (`practical_completion_date`) |

`quote`/`lost` jobs are excluded. Closed rows with no closed date appear only
under **All time**.

## Numbers

Per job/project: `computePnl` from `src/lib/pnl.ts` with the same inputs as
`loadPnl` (job: `contract_price` + adjustments; project: `contract_sum` +
approved variation `sell_amount`; approved timesheets at `cost_rate`; all
`costs` rows). All ex GST.

- **Live summary:** contract value (Σ price, priced rows only), cost to date
  (Σ cost, all rows), **headroom** = Σ(price − cost) over priced rows, **at
  risk** = count with drawdown > 80 % or margin < 0. Unpriced count noted.
- **Live table:** sorted worst first — negative headroom, then drawdown desc;
  unpriced rows last. Top 10, "Show all". Drawdown bar coloured by
  `drawdownTone`. Pending hours note when > 0.
- **Closed summary (for the period, priced rows):** jobs closed, revenue
  (Σ price), cost, margin earned (Σ margin), **average margin %** = Σ margin ÷
  Σ price (weighted). Best and worst by margin %.
- **Closed table:** newest closed first; price, cost, margin $, margin %
  (red when negative). Unpriced closed rows listed with "No price".

## Code

- `src/lib/pnl-portfolio.ts` (pure, tested): `PortfolioRow` type,
  `buildPortfolioRows(...)` (group bulk rows → `computePnl` per parent),
  `fyBounds(today)`, `closedInPeriod(rows, period, today)`,
  `summariseLive(rows)`, `summariseClosed(rows)`, `sortLive(rows)`.
- `src/lib/pnl-portfolio-queries.ts`: `loadPortfolioPnl(supabase)` — bulk,
  paged (1000-row pages) queries for jobs, projects, adjustments, approved
  variations, costs, timesheets; returns `PortfolioRow[]`.
- `src/app/(office)/margins-panel.tsx` (client): tabs, period switch, tables.
- `src/app/(office)/page.tsx`: load via `settle(...)` when `showMoney`, render
  the panel first in the money cards.
