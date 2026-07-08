# Takeoff & Estimating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A takeoff workspace on every quote: measure quantities directly on uploaded PDF plans (areas/lengths/counts with scale calibration), extract asbestos-survey ACM registers via the Claude API, explode quantities through assembly templates and waste/volume calculators, and push everything into quote sections as priced lines — with a quantity-schedule PDF as the audit trail.

**Architecture:** One migration (0045) adds `takeoff_sheets` / `takeoff_items` / `takeoff_assemblies` / `takeoff_assembly_components` + a provenance column on `quote_lines`. All tables are money-adjacent → admin/office-only RLS (same as quotes). Plans are stored as ordinary quote attachments (`attachments` table + bucket); a sheet references the attachment and holds per-page scale calibration. The measurement UI is a client-only component (pdfjs-dist render → `<canvas>`, SVG overlay for geometry); ALL quantity math lives in pure, vitest-tested functions in `src/lib/takeoff.ts`. AI ingestion degrades gracefully until `ANTHROPIC_API_KEY` exists (email-engine pattern).

**Tech Stack:** Next.js 16, Supabase, `pdfjs-dist` (NEW dependency — install with `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'; npm install pdfjs-dist`), Anthropic API (Phase 2, dormant until key), @react-pdf for the summary PDF, vitest.

**Conventions binding every task:** server actions = `requireRole('admin','office')` + zod `safeParse` + `{error?}` returns; migrations are WRITTEN + committed here and applied by the OWNER via dashboard SQL paste (include `supabase_migrations.schema_migrations` row in the paste, not the file); `npx vitest run --maxWorkers=1`; `npx tsc --noEmit` after every task; live DB — test writes `zz`-prefixed + cleaned.

**Existing rails (verified):**
- `rate_items` (0001:45-52): `kind ('labour','plant','material','subbie','other'), name, unit, cost, default_markup_pct, active`. Managed in Settings; already fed into the quote editor (`quotes/[id]/page.tsx:42` selects them, passes `rateItems` to the editor).
- Quote editor: `quote_sections` (title, position) + `quote_lines` (section_id, description, qty, unit, unit_cost, unit_sell, position). Editability guard `assertEditable` = draft/sent only (`quotes/actions.ts:36-51`).
- Quote attachments: PhotoUpload component (parentType 'quote', kind 'document'), signed URLs via `fetchAttachmentsWithUrls`.
- Settings page uses `SettingsTabs` (`settings/settings-tabs.tsx`, `VALID_TABS` in `settings/page.tsx:6`) — add an 'estimating' tab there.
- PDF infra: DocShell/tableStyles (`src/pdf/theme.ts:96`), office route dispatcher `api/pdf/[type]/[id]/route.tsx` (add case `takeoff`).
- Claude API calls: **READ the `claude-api` skill BEFORE writing Phase 2 code** (skill trigger requirement).

---

## Migration 0045 (Task 1 — write, commit, HAND TO OWNER IMMEDIATELY)

`supabase/migrations/0045_takeoff.sql` — complete content:

```sql
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
  -- component qty per 1 assembly unit (e.g. 0.04 crew-days per m2)
  factor numeric(14,4) not null default 1,
  -- OR a flat qty regardless of assembly qty (mobilisation, clearance, ...)
  fixed_qty numeric(14,3),
  position int not null default 0
);
create index takeoff_assembly_components_idx
  on takeoff_assembly_components (assembly_id, position);

-- Provenance: a quote line can point back at the takeoff item it came from.
alter table quote_lines add column takeoff_item_id uuid references takeoff_items(id);

-- RLS: admin/office FOR ALL (money tables pattern, 0003_rls.sql:60-76).
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

-- Starter assemblies (ECR asbestos work) — components reference NO rate_items
-- (owner maps rates later); factors are editable defaults, not gospel.
insert into takeoff_assemblies (name, unit, description) values
  ('Class A friable removal — ceiling/wall', 'm2',
   'Explodes m2 into removal labour, encapsulant, waste bags and air monitoring allowance'),
  ('Non-friable AC sheet removal', 'm2',
   'Bonded asbestos cement sheeting — labour, wrap, disposal allowance'),
  ('Asbestos job fixed costs', 'job',
   'Per-job pack: notification admin, decon unit, signage/barricading, clearance inspection');

insert into takeoff_assembly_components (assembly_id, description, unit, factor, fixed_qty, position)
select a.id, c.description, c.unit, c.factor, c.fixed_qty, c.position
from takeoff_assemblies a
join (values
  ('Class A friable removal — ceiling/wall', 'Removal labour', 'hr', 0.5, null, 0),
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
```

Owner paste = this file + `insert into supabase_migrations.schema_migrations (version, name, statements) values ('0045','takeoff',array['-- applied via dashboard SQL editor; source: supabase/migrations/0045_takeoff.sql']);`
NOTE the components CTE uses `factor` null for fixed rows — but `factor` is `not null default 1`; use `coalesce(c.factor, 1)` in the SELECT.

---

## Phase 1 — Measure & push to quote

### Task 1: Migration + zod schemas + pure math (TDD)
**Files:** Create `supabase/migrations/0045_takeoff.sql` (above, with the coalesce fix); Create `src/lib/takeoff.ts`; Test `tests/takeoff.test.ts`; Modify `src/lib/zod.ts`.

`src/lib/takeoff.ts` (pure; no supabase):
```ts
export type Pt = [number, number]
/** Shoelace area in PDF pt² (absolute). */
export function polygonAreaPt2(points: Pt[]): number
/** Sum of segment lengths in pt. */
export function polylineLengthPt(points: Pt[]): number
/** pt² → m² given metres-per-pt. */
export function areaM2(points: Pt[], mPerPt: number): number  // round to 3dp
export function lengthM(points: Pt[], mPerPt: number): number // round to 3dp
/** Calibration: known real-world metres over measured pt distance. */
export function scaleFromCalibration(p1: Pt, p2: Pt, metres: number): number
/** Waste: qty(m2|m3) × kg-per-unit → tonnes (3dp). */
export function wasteTonnes(qty: number, kgPerUnit: number): number
export const WASTE_PRESETS: { label: string; unit: 'm2' | 'm3'; kgPerUnit: number }[] = [
  { label: 'AC sheeting (fibro)', unit: 'm2', kgPerUnit: 15 },
  { label: 'Vinyl tiles + adhesive', unit: 'm2', kgPerUnit: 8 },
  { label: 'Contaminated soil', unit: 'm3', kgPerUnit: 1800 },
  { label: 'Concrete', unit: 'm3', kgPerUnit: 2400 },
]
/** Assembly explosion: one assembly qty → component line quantities. */
export function explodeAssembly(
  qty: number,
  components: { description: string; unit: string; factor: number; fixed_qty: number | null }[]
): { description: string; unit: string; qty: number }[]
// fixed_qty != null → qty = fixed_qty; else qty = round3(qty * factor)
```
Zod additions (`src/lib/zod.ts`): `takeoffSheetSchema {quote_id uuid, attachment_id uuid, name min1, page int min1}`, `takeoffItemSchema {quote_id uuid, sheet_id nullish, source enum, shape nullish enum, geometry any nullish, deduction bool default false, color nullish, description min1, qty coerce number, unit min1, rate_item_id nullish uuid, unit_cost coerce nullish, markup_pct coerce nullish, section_title nullish, notes nullish, group_id nullish uuid}`, `takeoffCalibrateSchema {scale_m_per_pt positive}`, `assemblySchema`/`assemblyComponentSchema` for settings CRUD.

Steps: failing tests (shoelace square/triangle, deduction not here — sign handled by caller; polyline; scale calibration; wasteTonnes; explodeAssembly fixed vs factor) → implement → green → commit `feat: takeoff schema, pure quantity math + starter assemblies (0045)`. **Then give the owner the 0045 paste.**

### Task 2: Server actions
**Files:** Create `src/app/(office)/quotes/[id]/takeoff/actions.ts`.
Actions (all `requireRole('admin','office')`, quote must exist + `assertEditable`-style status check for mutations that push lines; takeoff edits themselves allowed on any non-converted quote):
- `createTakeoffSheet(data)` — verify the attachment belongs to this quote (`attachments.parent_type='quote' and parent_id=quote_id`), insert sheet.
- `calibrateSheet(sheetId, quoteId, scaleMPerPt)` — update scale; RE-DERIVE qty of every measured item on the sheet (`areaM2`/`lengthM` from stored geometry) so recalibration fixes all quantities.
- `addTakeoffItem(data)` / `updateTakeoffItem(id, quoteId, data)` / `deleteTakeoffItem(id, quoteId)` — position handling like checklist items; when `rate_item_id` set and `unit_cost` null, resolve cost+markup from the rate item server-side.
- `applyAssembly(quoteId, assemblyId, qty, sectionTitle)` — load assembly+components, `explodeAssembly`, insert items (source 'assembly', shared `group_id = crypto.randomUUID()`), resolving component rate_item costs when linked.
- `pushTakeoffToQuote(quoteId)` — guard editable quote; group items by `section_title` (null → 'Takeoff'); for each group find-or-create `quote_sections` by title; insert `quote_lines` (description, qty, unit, unit_cost = item.unit_cost ?? 0, unit_sell = round2(cost × (1 + (markup_pct ?? settings-default 20)/100)), takeoff_item_id, position appended). SKIP items already pushed (exists quote_lines.takeoff_item_id = item.id) so re-push only adds new items. Return counts {pushed, skipped}.
Revalidate `/quotes/[id]` + `/quotes/[id]/takeoff`.
Commit `feat: takeoff server actions — sheets, items, assemblies, push-to-quote`.

### Task 3: pdfjs-dist + measurement canvas
**Files:** `npm install pdfjs-dist` (cert env var); Create `src/app/(office)/quotes/[id]/takeoff/takeoff-canvas.tsx` ('use client').
Component contract:
```ts
export interface CanvasItem { id: string; shape: 'area'|'line'|'count'; geometry: Pt[]; color: string | null; deduction: boolean; description: string; qty: number; unit: string }
export function TakeoffCanvas(props: {
  pdfUrl: string; page: number; scaleMPerPt: number | null;
  items: CanvasItem[];                       // saved shapes to overlay
  onCalibrated: (mPerPt: number) => void;    // fires after 2-point + distance dialog
  onShapeComplete: (shape: 'area'|'line'|'count', geometry: Pt[], qty: number, unit: string) => void;
  selectedId?: string | null; onSelect?: (id: string | null) => void;
})
```
Implementation notes: dynamic-import pdfjs (`const pdfjs = await import('pdfjs-dist')`; `pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`); render page at devicePixelRatio-aware scale into `<canvas>`; store a `renderScale` (canvas px per PDF pt) and keep ALL geometry in PDF pt coordinates (divide client coords by renderScale) so calibration/zoom never corrupts data. SVG absolutely positioned over the canvas, `viewBox="0 0 pageWpt pageHpt"` so saved geometry renders directly. Toolbar: Select / Calibrate / Area / Line / Count / Deduction-toggle + zoom +/- (re-render at new scale) . Drawing: click adds vertex (crosshair cursor), Enter or double-click completes (area needs ≥3 pts, line ≥2), Escape cancels; live preview polyline + running qty readout using props.scaleMPerPt (show "uncalibrated — pt units" when null and block Area/Line tools until calibrated, Count always allowed). Calibrate tool: two clicks → inline prompt dialog for metres → `scaleFromCalibration` → onCalibrated. Colors: cycle a fixed palette; deduction shapes render red-hatched (fill-opacity + dashed stroke); labels: qty text at polygon centroid.
Commit `feat: PDF takeoff canvas — calibrated areas, lengths and counts`.

### Task 4: Takeoff workspace page
**Files:** Create `src/app/(office)/quotes/[id]/takeoff/page.tsx` (server) + `takeoff-workspace.tsx` (client orchestrator); Modify `src/app/(office)/quotes/[id]/page.tsx` (link button "Takeoff" in the quote header actions area — find the header by grepping the editor component; the quote page renders QuoteEditor, so place the link on the page or editor header) .
Server page loads: quote (id/number/title/status), sheets, items (ordered), quote attachments (`fetchAttachmentsWithUrls` — pdf kind/document), rate items (active), assemblies (active, with components), signed URL per sheet attachment. Client workspace layout: left = sheet tabs + canvas (or empty state "Upload a plan below / pick an attachment"); right = items table (description, qty unit, rate mapping select, section, cost, sell, delete; totals footer) + buttons: Add manual item, Waste calculator, Apply assembly, Push to quote (with result toast). Item-create dialog appears on `onShapeComplete` (prefilled qty/unit) and for manual items; includes description, qty, unit, rate item select (auto-fills cost+markup), section title (datalist of existing quote sections + previous section_titles), notes. PhotoUpload (parentType quote, kind document) for new plans + "Use as sheet" per attachment PDF.
Commit `feat: takeoff workspace on quotes — measure, rate, push to quote`.

### Task 5: Phase-1 verification
Preview: open a real quote (e.g. Q-0010 or a zz test quote — PREFER creating `zz takeoff test` quote + delete after), upload a small PDF, calibrate, draw area/line/count, map a rate, push to quote, verify lines/sections appear, delete zz artifacts. tsc/vitest/lint green. Commit anything found.

## Phase 2 — Report ingestion (Claude API, dormant until key)

### Task 6: Extraction action + review UI
**READ the `claude-api` skill first.** Files: Create `src/lib/extract-takeoff.ts` (Anthropic REST call — plain fetch like email.ts, no SDK; model `claude-sonnet-5`; PDF as base64 document content block; tool-use/JSON output schema: array of {location, material, description, friable bool|null, condition, qty number|null, unit, recommendation}); Create action `ingestReportTakeoff(quoteId, attachmentId)` in takeoff/actions.ts — gate: `process.env.ANTHROPIC_API_KEY` missing → `{error: 'Add ANTHROPIC_API_KEY to the environment to enable report extraction'}`; download the attachment via storage signed URL fetch (≤20MB guard); call extractor; insert items source 'report' (description = "{material} — {location}", notes = condition/recommendation, unit/qty from extent, unrated). UI: "Extract from report" button per PDF attachment in the workspace → confirm dialog ("Sends this document to Anthropic for extraction") → runs → toast counts; items land in the table for review/rating. NEVER auto-push to quote.
Commit `feat: asbestos survey / report extraction into takeoff items (needs ANTHROPIC_API_KEY)`.

## Phase 3 — Estimator's brain

### Task 7: Settings → Estimating tab (assemblies CRUD)
Files: Create `src/app/(office)/settings/estimating-section.tsx`; Modify `settings/settings-tabs.tsx` + `settings/page.tsx` (VALID_TABS + data load + render); Create CRUD actions in `settings/actions.ts` (createAssembly/updateAssembly/setAssemblyActive/addAssemblyComponent/updateAssemblyComponent/deleteAssemblyComponent — admin/office). Table of assemblies → expand components (description, unit, factor OR fixed qty, rate item select). Commit `feat: assembly templates managed in Settings — Estimating`.

### Task 8: Calculators in the workspace
Waste calculator dialog (preset select or custom kg/unit; qty input → tonnes → creates item unit 't' description "Waste disposal — {preset}"); volume helper inside the item dialog (L×W×D or area×depth → fills qty for m3 units). Apply-assembly dialog (assembly select + qty + section). Commit `feat: waste + volume calculators and assembly application in takeoff`.

## Phase 4 — Quantity schedule PDF

### Task 9: `/api/pdf/takeoff/[quoteId]`
Files: Create `src/pdf/TakeoffPdf.tsx` + case `takeoff` in the office pdf dispatcher (MONEY_ROLES default). DocShell "Takeoff schedule", grouped by section: rows Description / Qty / Unit / Source (Measured — {sheet name} | Report | Assembly | Manual) / Rate / Amount(cost) with section subtotals + grand total (cost + sell). Button in the workspace header. Commit `feat: takeoff quantity-schedule PDF`.

### Task 10: Final verification + docs
Full suite + lint + preview click-through (workspace, calculators, settings tab, PDF) + push to main AFTER 0045 is applied + prod smoke + memory update.

## Deliberately out (note in final summary)
- Marked-up plan snapshots inside the PDF (in-app overlay is the markup viewer; snapshot export is a later nicety).
- Plan-drawing AI analysis (Phase 2 covers text reports; vision takeoff of drawings is future).
- Cut/fill from survey surfaces (real civil estimating suites do this; out of scope).
