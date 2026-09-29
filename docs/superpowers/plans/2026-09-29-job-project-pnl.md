# Job & Project P&L Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running P&L (price − recorded cost = margin, % drawdown) on every job and project, with the job price carried over from the accepted quote.

**Architecture:** Migration 0066 adds `jobs.contract_price`, `job_price_adjustments`, labour columns on the existing `costs` ledger, and a locked `timesheet_entries.cost_rate` stamped by trigger at approval. A pure `src/lib/pnl.ts` computes the summary; `src/lib/pnl-queries.ts` loads it for a parent; `src/lib/pnl-actions.ts` holds the admin/office server actions; one `<PnlPanel>` renders on the job page and a new project `/pnl` tab.

**Tech Stack:** Next.js 16 app router (server components + server actions), Supabase (Postgres + RLS), zod 4, vitest, shadcn/base-ui components, sonner toasts.

Spec: `docs/superpowers/specs/2026-09-29-job-project-pnl-design.md`

## Global Constraints

- All money is numeric dollars **ex GST**, rounded with `round2` from `src/lib/money.ts`.
- Money data is admin/office only (RLS `current_app_role() in ('admin','office')`; UI gated by `canSeeCosts` / `showMoney`).
- Timesheet hours = `end_at − start_at` in full; only `approved` and closed entries count; rate = `timesheet_entries.cost_rate`.
- Docket-sourced cost rows (`source = 'docket'`) stay read-only in the UI and actions.
- Test runner: `npx vitest run <file>`; typecheck: `npx tsc --noEmit`. Prefix npm/npx with `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'` only when network is needed.

---

### Task 1: Migration 0066

**Files:**
- Create: `supabase/migrations/0066_job_pnl.sql`

**Interfaces:**
- Produces: columns `jobs.contract_price`, `costs.hours/rate/worker_id/worker_name`, `costs.source` ∈ manual|docket|labour, `timesheet_entries.cost_rate`, table `job_price_adjustments(id, job_id, date, description, amount, created_by, created_at)`.

- [ ] **Step 1: Write the migration**

```sql
-- 0066: job & project P&L.
--   * jobs.contract_price — quote sell subtotal (ex GST) stored at conversion
--   * job_price_adjustments — +/- log on top of the job price
--   * costs gains labour lines (hours × rate, staff or typed worker)
--   * timesheet_entries.cost_rate — profiles.hourly_cost locked at approval

alter table jobs add column contract_price numeric(14,2);

update jobs j
set contract_price = q.subtotal
from (
  select quote_id, round(sum(round(qty * unit_sell, 2)), 2) as subtotal
  from quote_lines
  group by quote_id
) q
where j.quote_id = q.quote_id and j.contract_price is null;

create table job_price_adjustments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  date date not null default current_date,
  description text not null,
  amount numeric(14,2) not null check (amount <> 0),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index job_price_adjustments_job_idx on job_price_adjustments (job_id);
alter table job_price_adjustments enable row level security;
create policy job_price_adjustments_admin_office_all on job_price_adjustments
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

alter table costs
  add column hours numeric(8,2),
  add column rate numeric(10,2),
  add column worker_id uuid references profiles(id),
  add column worker_name text;
alter table costs drop constraint if exists costs_source_check;
alter table costs add constraint costs_source_check
  check (source in ('manual','docket','labour'));
alter table costs add constraint costs_labour_fields_check
  check (source <> 'labour' or (hours > 0 and rate >= 0));
create index if not exists costs_parent_idx on costs (parent_type, parent_id);

alter table timesheet_entries add column cost_rate numeric(10,2);

-- Backfill BEFORE the trigger exists (the trigger would keep the old null).
update timesheet_entries t
set cost_rate = p.hourly_cost
from profiles p
where p.id = t.user_id and t.approved;

create or replace function timesheet_stamp_cost_rate() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.approved and (tg_op = 'INSERT' or not old.approved) then
    new.cost_rate := (select hourly_cost from profiles where id = new.user_id);
  elsif not new.approved then
    new.cost_rate := null;
  elsif current_app_role() is distinct from 'admin'
        and current_app_role() is distinct from 'office' then
    new.cost_rate := old.cost_rate;
  end if;
  return new;
end $$;

create trigger timesheet_entries_cost_rate
  before insert or update on timesheet_entries
  for each row execute function timesheet_stamp_cost_rate();
```

- [ ] **Step 2: Verify the constraint name** — `grep -rn "costs_source_check" supabase/` returns nothing else; Postgres default name for the inline check on `costs.source` is `costs_source_check` (confirm live with `select conname from pg_constraint where conrelid='costs'::regclass` via the ecr-portal `sql` tool before applying).

- [ ] **Step 3: Commit** — `git add supabase/migrations/0066_job_pnl.sql && git commit -m "feat(pnl): migration 0066 — job price, adjustments, labour cost lines, locked timesheet rate"`

---

### Task 2: Pure P&L calculation

**Files:**
- Create: `src/lib/pnl.ts`
- Test: `tests/pnl.test.ts`

**Interfaces:**
- Produces:
  - `type CostCategory = 'labour'|'plant'|'materials'|'subcontract'|'other'`
  - `const COST_CATEGORIES: { key: CostCategory; label: string }[]`
  - `type CostSource = 'manual'|'docket'|'labour'`
  - `entryHours(startAt: string, endAt: string|null, now: Date): number` (raw, unrounded)
  - `costCategory(source: CostSource, codeCategory: CostCategory|null): CostCategory`
  - `labourAmount(hours: number, rate: number): number`
  - `computePnl(input: PnlInput): PnlSummary`
  - `drawdownTone(pct: number|null): 'ok'|'warn'|'over'`

- [ ] **Step 1: Write the failing tests** (`tests/pnl.test.ts`)

```ts
import { describe, expect, test } from 'vitest'
import { computePnl, costCategory, drawdownTone, entryHours, labourAmount } from '../src/lib/pnl'

const NOW = new Date('2026-09-29T06:00:00Z')

describe('entryHours', () => {
  test('closed entry counts in full', () => {
    expect(entryHours('2026-09-28T21:00:00Z', '2026-09-29T05:30:00Z', NOW)).toBe(8.5)
  })
  test('open entry measured to now', () => {
    expect(entryHours('2026-09-29T04:00:00Z', null, NOW)).toBe(2)
  })
  test('never negative', () => {
    expect(entryHours('2026-09-29T07:00:00Z', '2026-09-29T06:00:00Z', NOW)).toBe(0)
  })
})

test('costCategory prefers the cost code, then labour source, then other', () => {
  expect(costCategory('manual', 'plant')).toBe('plant')
  expect(costCategory('labour', null)).toBe('labour')
  expect(costCategory('labour', 'subcontract')).toBe('subcontract')
  expect(costCategory('docket', null)).toBe('other')
})

test('labourAmount rounds hours × rate', () => {
  expect(labourAmount(7.5, 62.35)).toBe(467.63)
})

describe('computePnl', () => {
  const base = {
    basePrice: 10000,
    adjustments: [1500, -500],
    now: NOW,
    timesheets: [
      { userId: 'u1', workerName: 'Sam', startAt: '2026-09-28T21:00:00Z', endAt: '2026-09-29T05:00:00Z', approved: true, costRate: 50 },
      { userId: 'u1', workerName: 'Sam', startAt: '2026-09-27T21:00:00Z', endAt: '2026-09-28T01:00:00Z', approved: true, costRate: 50 },
      { userId: 'u2', workerName: 'Alex', startAt: '2026-09-28T21:00:00Z', endAt: '2026-09-28T23:00:00Z', approved: true, costRate: null },
      { userId: 'u3', workerName: 'Jo', startAt: '2026-09-28T21:00:00Z', endAt: '2026-09-29T00:00:00Z', approved: false, costRate: null },
      { userId: 'u3', workerName: 'Jo', startAt: '2026-09-29T05:00:00Z', endAt: null, approved: false, costRate: null },
    ],
    costs: [
      { amount: 400, source: 'labour' as const, category: null },
      { amount: 1200, source: 'manual' as const, category: 'plant' as const },
      { amount: 300, source: 'docket' as const, category: null },
    ],
  }

  test('price = base + adjustments', () => {
    const s = computePnl(base)
    expect(s.adjustmentsTotal).toBe(1000)
    expect(s.price).toBe(11000)
  })

  test('timesheet labour groups approved hours by worker and rate', () => {
    const s = computePnl(base)
    expect(s.timesheetLabour.hours).toBe(14)
    expect(s.timesheetLabour.cost).toBe(600)
    const sam = s.timesheetLabour.workers.find((w) => w.userId === 'u1')!
    expect(sam).toMatchObject({ hours: 12, rate: 50, cost: 600, missingRate: false })
    const alex = s.timesheetLabour.workers.find((w) => w.userId === 'u2')!
    expect(alex).toMatchObject({ hours: 2, rate: null, cost: 0, missingRate: true })
  })

  test('pending = unapproved + open hours, not costed', () => {
    const s = computePnl(base)
    expect(s.pendingHours).toBe(4)
  })

  test('category breakdown, total cost, margin and drawdown', () => {
    const s = computePnl(base)
    expect(s.byCategory).toEqual({ labour: 1000, plant: 1200, materials: 0, subcontract: 0, other: 300 })
    expect(s.cost).toBe(2500)
    expect(s.margin).toBe(8500)
    expect(s.marginPct).toBeCloseTo(77.27, 2)
    expect(s.drawdownPct).toBeCloseTo(22.73, 2)
  })

  test('no price → margin and percentages are null', () => {
    const s = computePnl({ ...base, basePrice: null, adjustments: [] })
    expect(s.price).toBeNull()
    expect(s.margin).toBeNull()
    expect(s.marginPct).toBeNull()
    expect(s.drawdownPct).toBeNull()
  })

  test('adjustments without a base still make a price', () => {
    expect(computePnl({ ...base, basePrice: null, adjustments: [2000] }).price).toBe(2000)
  })
})

test('drawdownTone thresholds', () => {
  expect(drawdownTone(null)).toBe('ok')
  expect(drawdownTone(80)).toBe('ok')
  expect(drawdownTone(80.1)).toBe('warn')
  expect(drawdownTone(100.1)).toBe('over')
})
```

- [ ] **Step 2: Run** `npx vitest run tests/pnl.test.ts` — expect FAIL (module missing).

- [ ] **Step 3: Implement** `src/lib/pnl.ts`

```ts
import { round2 } from './money'

export type CostCategory = 'labour' | 'plant' | 'materials' | 'subcontract' | 'other'
export type CostSource = 'manual' | 'docket' | 'labour'

export const COST_CATEGORIES: { key: CostCategory; label: string }[] = [
  { key: 'labour', label: 'Labour' },
  { key: 'plant', label: 'Plant & equipment' },
  { key: 'materials', label: 'Materials & consumables' },
  { key: 'subcontract', label: 'Subcontract' },
  { key: 'other', label: 'Other' },
]

export interface PnlTimesheetRow {
  userId: string
  workerName: string
  startAt: string
  endAt: string | null
  approved: boolean
  costRate: number | null
}

export interface PnlCostRow {
  amount: number
  source: CostSource
  /** The row's cost code category, null when it has no cost code. */
  category: CostCategory | null
}

export interface PnlInput {
  basePrice: number | null
  adjustments: number[]
  timesheets: PnlTimesheetRow[]
  costs: PnlCostRow[]
  now?: Date
}

export interface PnlWorkerLabour {
  userId: string
  workerName: string
  hours: number
  rate: number | null
  cost: number
  missingRate: boolean
}

export interface PnlSummary {
  basePrice: number | null
  adjustmentsTotal: number
  price: number | null
  timesheetLabour: { workers: PnlWorkerLabour[]; hours: number; cost: number }
  pendingHours: number
  byCategory: Record<CostCategory, number>
  cost: number
  margin: number | null
  marginPct: number | null
  drawdownPct: number | null
}

/** Clock on → clock off in full (open entries measured to `now`), in hours. */
export function entryHours(startAt: string, endAt: string | null, now: Date): number {
  const end = endAt ? new Date(endAt).getTime() : now.getTime()
  const ms = end - new Date(startAt).getTime()
  return ms > 0 ? ms / 3_600_000 : 0
}

export function costCategory(source: CostSource, codeCategory: CostCategory | null): CostCategory {
  if (codeCategory) return codeCategory
  return source === 'labour' ? 'labour' : 'other'
}

export function labourAmount(hours: number, rate: number): number {
  return round2(hours * rate)
}

export function computePnl(input: PnlInput): PnlSummary {
  const now = input.now ?? new Date()
  const adjustmentsTotal = round2(input.adjustments.reduce((s, a) => s + a, 0))
  const price =
    input.basePrice == null && input.adjustments.length === 0
      ? null
      : round2((input.basePrice ?? 0) + adjustmentsTotal)

  // Approved, closed entries → grouped by worker + locked rate (a rate change
  // between approvals shows as two rows for the same person).
  const groups = new Map<string, PnlWorkerLabour>()
  let pending = 0
  for (const t of input.timesheets) {
    const hours = entryHours(t.startAt, t.endAt, now)
    if (!t.approved || !t.endAt) {
      pending += hours
      continue
    }
    const key = `${t.userId}:${t.costRate ?? 'none'}`
    const g =
      groups.get(key) ??
      { userId: t.userId, workerName: t.workerName, hours: 0, rate: t.costRate, cost: 0, missingRate: t.costRate == null }
    g.hours += hours
    g.cost += t.costRate == null ? 0 : hours * t.costRate
    groups.set(key, g)
  }
  const workers = [...groups.values()]
    .map((g) => ({ ...g, hours: round2(g.hours), cost: round2(g.cost) }))
    .sort((a, b) => a.workerName.localeCompare(b.workerName))
  const tsHours = round2(workers.reduce((s, w) => s + w.hours, 0))
  const tsCost = round2(workers.reduce((s, w) => s + w.cost, 0))

  const byCategory: Record<CostCategory, number> = { labour: tsCost, plant: 0, materials: 0, subcontract: 0, other: 0 }
  for (const c of input.costs) {
    const cat = costCategory(c.source, c.category)
    byCategory[cat] = round2(byCategory[cat] + c.amount)
  }
  const cost = round2(Object.values(byCategory).reduce((s, v) => s + v, 0))

  const hasPrice = price != null && price !== 0
  const margin = price == null ? null : round2(price - cost)
  return {
    basePrice: input.basePrice,
    adjustmentsTotal,
    price,
    timesheetLabour: { workers, hours: tsHours, cost: tsCost },
    pendingHours: round2(pending),
    byCategory,
    cost,
    margin,
    marginPct: hasPrice ? ((price - cost) / price) * 100 : null,
    drawdownPct: hasPrice ? (cost / price) * 100 : null,
  }
}

export function drawdownTone(pct: number | null): 'ok' | 'warn' | 'over' {
  if (pct == null || pct <= 80) return 'ok'
  return pct > 100 ? 'over' : 'warn'
}
```

- [ ] **Step 4: Run** `npx vitest run tests/pnl.test.ts` — expect PASS.
- [ ] **Step 5: Commit** — `git add src/lib/pnl.ts tests/pnl.test.ts && git commit -m "feat(pnl): pure P&L calculation"`

---

### Task 3: Job price at conversion

**Files:**
- Modify: `src/lib/convert.ts` (`JobPayload` + `jobPayloadFromQuote`)
- Modify: `tests/convert.test.ts`
- Modify: `src/app/(office)/quotes/actions.ts` (`convertQuoteToJob` passes `gst_rate: 0`, already fine — payload now carries `contract_price`)

**Interfaces:**
- Produces: `JobPayload.contract_price: number | null` — sell subtotal ex GST of all lines, `null` when there are no lines.

- [ ] **Step 1: Failing tests** — add to `describe('jobPayloadFromQuote')`:

```ts
  test('contract_price = sell subtotal ex GST of all lines', () => {
    const payload = jobPayloadFromQuote(QUOTE, 'J-0005', SECTIONS, LINES)
    expect(payload.contract_price).toBe(650.5)
  })

  test('contract_price is null when the quote has no lines', () => {
    expect(jobPayloadFromQuote(QUOTE, 'J-0006').contract_price).toBeNull()
  })
```

(`LINES` is the existing fixture whose sell subtotal comment says 650.50.)

- [ ] **Step 2: Run** `npx vitest run tests/convert.test.ts` — FAIL.
- [ ] **Step 3: Implement** — add `contract_price: number | null` to `JobPayload`, and in `jobPayloadFromQuote`:

```ts
    contract_price:
      lines.length === 0
        ? null
        : docTotals(lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })), 0).subtotal,
```

- [ ] **Step 4: Run** tests — PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(pnl): store the quote price on the job at conversion`

---

### Task 4: Validation schemas + server actions

**Files:**
- Modify: `src/lib/zod.ts` (add schemas after `jobCostSchema`)
- Create: `src/lib/pnl-actions.ts`
- Modify: `src/app/(office)/jobs/actions.ts` (remove `addJobCost` + `jobCostSchema` import)
- Modify: `src/lib/zod.ts` (remove `jobCostSchema`/`JobCostInput` if unused)

**Interfaces:**
- Produces (all `Promise<{ error?: string }>`, admin/office only):
  - `addCostLine(data: unknown)`, `updateCostLine(id: string, data: unknown)`, `deleteCostLine(id: string)`
  - `addPriceAdjustment(data: unknown)`, `deletePriceAdjustment(id: string)`
  - `setJobBasePrice(data: unknown)`
- Cost line input: `{ kind: 'labour'|'other', parent_type: 'job'|'project', parent_id, date, description, cost_code_id|null, amount?, hours?, rate?, worker_id?|null, worker_name?|null }`

- [ ] **Step 1: Schemas** in `src/lib/zod.ts`:

```ts
// ─── P&L ──────────────────────────────────────────────────────────────────────

export const costLineSchema = z
  .object({
    kind: z.enum(['labour', 'other']),
    parent_type: z.enum(['job', 'project']),
    parent_id: z.uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required'),
    description: z.string().trim().max(500).default(''),
    cost_code_id: z.uuid().nullish().transform((v) => v ?? null),
    amount: z.coerce.number().positive('Amount must be positive').max(100_000_000).optional(),
    hours: z.coerce.number().positive('Hours must be positive').max(10_000).optional(),
    rate: z.coerce.number().min(0, 'Rate cannot be negative').max(100_000).optional(),
    worker_id: z.uuid().nullish().transform((v) => v ?? null),
    worker_name: z.string().trim().max(120).nullish().transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'labour') {
      if (v.hours == null) ctx.addIssue({ code: 'custom', message: 'Hours are required', path: ['hours'] })
      if (v.rate == null) ctx.addIssue({ code: 'custom', message: 'Rate is required', path: ['rate'] })
      if (!v.worker_id && !v.worker_name)
        ctx.addIssue({ code: 'custom', message: 'Pick a worker or type a name', path: ['worker_name'] })
    } else {
      if (v.amount == null) ctx.addIssue({ code: 'custom', message: 'Amount is required', path: ['amount'] })
      if (!v.description) ctx.addIssue({ code: 'custom', message: 'Description is required', path: ['description'] })
    }
  })
export type CostLineInput = z.infer<typeof costLineSchema>

export const priceAdjustmentSchema = z.object({
  job_id: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required'),
  description: z.string().trim().min(1, 'Description is required').max(500),
  amount: z.coerce.number().refine((n) => n !== 0, 'Amount cannot be zero'),
})

export const jobBasePriceSchema = z.object({
  job_id: z.uuid(),
  price: z.coerce.number().min(0, 'Price cannot be negative').max(100_000_000),
})
```

- [ ] **Step 2: Actions** `src/lib/pnl-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { costLineSchema, jobBasePriceSchema, priceAdjustmentSchema, type CostLineInput } from '@/lib/zod'
import { labourAmount } from '@/lib/pnl'
import { round2 } from '@/lib/money'

type Result = { error?: string }
type Supabase = Awaited<ReturnType<typeof createClient>>

function revalidateParent(parentType: string, parentId: string) {
  if (parentType === 'job') {
    revalidatePath(`/jobs/${parentId}`)
  } else {
    revalidatePath(`/projects/${parentId}`)
    revalidatePath(`/projects/${parentId}/budget`)
    revalidatePath(`/projects/${parentId}/pnl`)
  }
}

/** Builds the costs-row fields for a validated line (shared by add + update). */
async function costFields(supabase: Supabase, d: CostLineInput) {
  if (d.kind === 'other') {
    return {
      date: d.date,
      description: d.description,
      amount: round2(d.amount!),
      cost_code_id: d.cost_code_id,
      source: 'manual' as const,
      hours: null,
      rate: null,
      worker_id: null,
      worker_name: null,
    }
  }
  let workerName = d.worker_name
  if (d.worker_id) {
    const { data: p } = await supabase.from('profiles').select('full_name').eq('id', d.worker_id).single()
    if (!p) return { error: 'Worker not found' }
    workerName = null
    if (!d.description) d.description = `Labour — ${p.full_name}`
  }
  return {
    date: d.date,
    description: d.description || `Labour — ${workerName}`,
    amount: labourAmount(d.hours!, d.rate!),
    cost_code_id: d.cost_code_id,
    source: 'labour' as const,
    hours: d.hours!,
    rate: d.rate!,
    worker_id: d.worker_id,
    worker_name: workerName,
  }
}

export async function addCostLine(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const parsed = costLineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const fields = await costFields(supabase, parsed.data)
  if ('error' in fields) return { error: fields.error }

  const { error } = await supabase.from('costs').insert({
    ...fields,
    parent_type: parsed.data.parent_type,
    parent_id: parsed.data.parent_id,
    created_by: profile.id,
  })
  if (error) return { error: error.message }
  revalidateParent(parsed.data.parent_type, parsed.data.parent_id)
  return {}
}

/** Loads a cost row and refuses docket rows / parent mismatches. */
async function editableCost(supabase: Supabase, id: string) {
  const { data: row } = await supabase
    .from('costs')
    .select('id, parent_type, parent_id, source')
    .eq('id', id)
    .single()
  if (!row) return { error: 'Cost not found' } as const
  if (row.source === 'docket') return { error: 'Docket costs are managed from the docket' } as const
  return { row } as const
}

export async function updateCostLine(id: string, data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const parsed = costLineSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const found = await editableCost(supabase, id)
  if ('error' in found) return { error: found.error }
  if (found.row.parent_type !== parsed.data.parent_type || found.row.parent_id !== parsed.data.parent_id) {
    return { error: 'Cost does not belong to this record' }
  }

  const fields = await costFields(supabase, parsed.data)
  if ('error' in fields) return { error: fields.error }

  const { error } = await supabase.from('costs').update(fields).eq('id', id)
  if (error) return { error: error.message }
  revalidateParent(found.row.parent_type, found.row.parent_id)
  return {}
}

export async function deleteCostLine(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const found = await editableCost(supabase, id)
  if ('error' in found) return { error: found.error }

  const { error } = await supabase.from('costs').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidateParent(found.row.parent_type, found.row.parent_id)
  return {}
}

export async function addPriceAdjustment(data: unknown): Promise<Result> {
  const profile = await requireRole('admin', 'office')
  const parsed = priceAdjustmentSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const { error } = await supabase.from('job_price_adjustments').insert({
    ...parsed.data,
    amount: round2(parsed.data.amount),
    created_by: profile.id,
  })
  if (error) return { error: error.message }
  revalidateParent('job', parsed.data.job_id)
  return {}
}

export async function deletePriceAdjustment(id: string): Promise<Result> {
  await requireRole('admin', 'office')
  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('job_price_adjustments')
    .delete()
    .eq('id', id)
    .select('job_id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Adjustment not found' }
  revalidateParent('job', row.job_id)
  return {}
}

/** Hand-set base price — only for jobs without a quote-derived price. */
export async function setJobBasePrice(data: unknown): Promise<Result> {
  await requireRole('admin', 'office')
  const parsed = jobBasePriceSchema.safeParse(data)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }

  const supabase = await createClient()
  const { data: job } = await supabase
    .from('jobs')
    .select('id, quote_id, contract_price')
    .eq('id', parsed.data.job_id)
    .single()
  if (!job) return { error: 'Job not found' }
  if (job.quote_id && job.contract_price != null) {
    return { error: 'This price came from the accepted quote — use an adjustment instead' }
  }

  const { error } = await supabase
    .from('jobs')
    .update({ contract_price: round2(parsed.data.price) })
    .eq('id', job.id)
  if (error) return { error: error.message }
  revalidateParent('job', job.id)
  return {}
}
```

- [ ] **Step 3:** Remove `addJobCost` and the `jobCostSchema` import from `src/app/(office)/jobs/actions.ts`; delete `jobCostSchema`/`JobCostInput` from `src/lib/zod.ts` if `grep -rn jobCostSchema src tests` shows no other users.
- [ ] **Step 4:** `npx tsc --noEmit` — clean (job page still imports `CostsSection`, which imports `addJobCost` → fix in Task 6; do Tasks 4–6 before typechecking if needed).
- [ ] **Step 5: Commit** — `feat(pnl): cost line, price adjustment and base price actions`

---

### Task 5: Loader

**Files:**
- Create: `src/lib/pnl-queries.ts`

**Interfaces:**
- Consumes: `computePnl`, `CostCategory`, `CostSource` (Task 2).
- Produces:

```ts
export interface PnlCostLine {
  id: string; date: string; description: string; amount: number; source: CostSource
  hours: number | null; rate: number | null; worker_id: string | null; worker_name: string | null
  worker_label: string | null; cost_code_id: string | null; cost_code_label: string | null
}
export interface PnlWorkerOption { id: string; full_name: string; hourly_cost: number | null }
export interface PnlCostCodeOption { id: string; code: string; name: string }
export type PnlPrice =
  | { mode: 'job'; basePrice: number | null; hasQuote: boolean; adjustments: { id: string; date: string; description: string; amount: number }[] }
  | { mode: 'project'; contractSum: number; approvedVariations: number }
export interface PnlData { summary: PnlSummary; price: PnlPrice; costLines: PnlCostLine[]; workers: PnlWorkerOption[]; costCodes: PnlCostCodeOption[] }
export async function loadPnl(supabase, parentType: 'job'|'project', parentId: string): Promise<PnlData | null>
```

- [ ] **Step 1: Implement** — parallel queries: parent row (`jobs: id, quote_id, contract_price` / `projects: id, contract_sum`), adjustments (job) or approved variations `sell_amount` (project), `costs` for the parent (`id, date, description, amount, source, hours, rate, worker_id, worker_name, cost_code_id, cost_codes(code, name, category)`, ordered date desc, created_at desc), `timesheet_entries` (`user_id, start_at, end_at, approved, cost_rate`, filtered by `job_id`/`project_id`), `profiles` (`id, full_name, hourly_cost, active`, ordered by name), `cost_codes` (`id, code, name, active`, ordered by code). Map to `computePnl` inputs (`Number()` every numeric), worker names from the profiles map (fallback 'Unknown'), worker option list = active profiles. Return `null` if the parent is missing.
- [ ] **Step 2:** `npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `feat(pnl): P&L loader`

---

### Task 6: `<PnlPanel>` UI + job page

**Files:**
- Create: `src/components/pnl/PnlPanel.tsx` (server-safe wrapper markup is fine as a client component: summary strip, drawdown bar, price card, category breakdown, timesheet labour)
- Create: `src/components/pnl/CostLinesTable.tsx` (table + add/edit dialog + delete)
- Create: `src/components/pnl/PriceAdjustments.tsx` (job price block: base, adjustments list, add dialog, set-price dialog)
- Modify: `src/app/(office)/jobs/[id]/page.tsx` (replace `CostsSection` with `PnlPanel` fed by `loadPnl`, drop the now-unused `costs` query/mapping)
- Delete: `src/app/(office)/jobs/[id]/costs-section.tsx`

**Interfaces:**
- Consumes: `PnlData` (Task 5), actions (Task 4), `drawdownTone`, `COST_CATEGORIES`, `labourAmount` (Task 2).
- Produces: `PnlPanel({ parentType, parentId, data, variationsHref? }: { parentType: 'job'|'project'; parentId: string; data: PnlData; variationsHref?: string })`

- [ ] **Step 1:** Build components following `costs-section.tsx` (Dialog/Select/Table/MoneyInput/sonner patterns, `aud`/`fmtDate`). Behaviour:
  - Summary strip: 4 tiles (Price, Cost to date, Margin with %, Drawdown %) + bar width `min(drawdown,100)%`, colour by `drawdownTone` (ok = primary, warn = amber-500, over = red-600). "No price set" when price is null.
  - Price (job): "Quote price" (or "Base price") row, adjustments list (date, description, ±amount, delete button with `confirm()`), "Add adjustment" dialog (date, description, `MoneyInput allowNegative`), "Set price" dialog shown when `!hasQuote || basePrice == null`. Project: contract sum, approved variations (link `variationsHref`), current price.
  - Breakdown: one row per `COST_CATEGORIES` with amount and % of cost (hide zero rows; show "No costs yet" when cost is 0).
  - Timesheet labour table: worker, hours, rate (`—` + "no rate set" badge when missing), cost; footer total; muted line "Pending: X h unapproved or still clocked on — not counted" when `pendingHours > 0`.
  - Cost lines: columns Date, Description (labour shows `worker · 7.5 h × $62.00` beneath), Cost code, Source badge (Labour/Manual/Docket), Amount, actions (edit/delete hidden for docket). Add/Edit dialog with a Labour | Other cost segmented toggle. Labour: worker Select (staff + "Other (type name)"), name Input when other, hours Input (number, step 0.25), rate MoneyInput prefilled from the selected worker's `hourly_cost`, live amount = `labourAmount`, optional cost code + description. Other: date, description, cost code, amount.
- [ ] **Step 2:** Job page: add `loadPnl(supabase, 'job', id)` inside the `canSeeCosts` block; render `<section>` "Costs & P&L" via `<PnlPanel parentType="job" parentId={job.id} data={pnl} />` where `CostsSection` was. Remove the `costs` query and `costsData`; keep `costCodes` if DocketTable still uses it.
- [ ] **Step 3:** `npx tsc --noEmit` + `npx eslint src/components/pnl src/lib/pnl*.ts "src/app/(office)/jobs"`.
- [ ] **Step 4: Commit** — `feat(pnl): Costs & P&L panel on the job page`

---

### Task 7: Project P&L tab

**Files:**
- Modify: `src/app/(office)/projects/[id]/project-tabs.tsx` (add `{ label: 'P&L', suffix: '/pnl', money: true }` after Budget)
- Create: `src/app/(office)/projects/[id]/pnl/page.tsx`

- [ ] **Step 1:** Page: `requireRole('admin','office')`, `loadPnl(supabase,'project',id)`, `notFound()` on null, render `<PnlPanel parentType="project" parentId={id} data={data} variationsHref={`/projects/${id}/variations`} />`.
- [ ] **Step 2:** `npx tsc --noEmit`, full `npx vitest run`, `npx next build` (Norton prefix).
- [ ] **Step 3: Commit** — `feat(pnl): project P&L tab`

---

### Task 8: Ship

- [ ] Code review of the branch diff (requesting-code-review), fix findings.
- [ ] Apply 0066 to live (`zspauxavbhtutanhekuu`) — via an available Supabase DDL connector, else hand the owner the SQL for the SQL editor; add the `schema_migrations` row `0066`. Verify: `select count(*) from jobs where contract_price is not null`, trigger present, constraint present.
- [ ] Local click-through against live DB on a zz job (dev server with Norton prefix): add labour + other lines, adjustment, confirm numbers; delete zz data and rewind `sequences` `work_number:26` if a job was created.
- [ ] Merge to main (fetch + merge origin/main first), push, confirm Vercel deploy, spot-check live page HTTP 200.
