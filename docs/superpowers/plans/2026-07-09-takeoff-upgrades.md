# Takeoff & Estimating Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner-approved upgrade batch: canvas drawing QoL (undo point, scale presets, multipliers, legend, vertex editing), duplicate quote, CSV rate import — then (Phase B, separate migration) plan snapshot in the Schedule PDF and quote cost-category breakdown.

**Architecture:** Phase A is code-only (no schema change — multipliers transform qty at item-save time; legend derives from item colours). Phase B adds `takeoff_sheets.snapshot_path` + `quote_lines.kind` in migration 0049. Deferred by owner priority: Claude auto-count (needs ANTHROPIC_API_KEY live), Xero integration (own project).

**Ordering rationale:** highest daily-use value first, no-migration work ships without waiting on a SQL paste, canvas/geometry stays with Fable (delegation policy), mechanical clone/import features go to Opus agents.

---

### Task A1 (Fable): canvas — undo last point + scale presets

- `takeoff-canvas.tsx`: Backspace removes the last draft/calibration point (extend the existing `onKey` handler; ignore when an input is focused).
- Scale presets: a Select next to the Calibrate tool with common AU plan scales (1:50/1:100/1:200/1:250/1:500 at A3 and A1). Picking one calls `onCalibrated(mPerPt)` directly, where `mPerPt = ratio × 0.000352778` (1 pt = 0.352778 mm of paper; paper mm × ratio = real mm). Requires knowing the PDF page is true paper size — note in the UI ("if the PDF is to scale").

### Task A2 (Fable): measurement multipliers in the item dialog

- `takeoff-workspace.tsx` item dialog: when the draft has shape `area` → optional "Depth (m)" and "Pitch factor" inputs; shape `line` → optional "Height (m)". On save, qty = base × multiplier(s); unit auto-switches (area+depth → m3, line+height → m2); a note is appended recording the derivation ("125 m² × 0.3 m depth"). Pure UI transform — geometry stays the plan measurement.

### Task A3 (Fable): colour legend + visibility toggles

- `takeoff-workspace.tsx`: legend chips above the canvas — one per distinct colour among the active sheet's items, labelled by the first item description, click toggles visibility; hidden colours' shapes are filtered out of the `items` passed to the canvas. Client-side state only.

### Task A4 (Fable): vertex editing in select mode

- `takeoff-canvas.tsx`: in `select` tool, clicking a shape shows draggable vertex handles; pointer-drag moves a vertex (pt coords via the existing `toPt` conversion); on pointer-up fire a new `onGeometryEdited(itemId, geometry)` callback. `takeoff-workspace.tsx` handles it: recompute qty for measured items (areaM2/lengthM with sheet scale) and call `updateTakeoffItem` with the same payload shape the dialog uses (keeping cost/rate fields).

### Task A5 (Opus agent): duplicate quote

- `duplicateQuote(quoteId)` server action in quotes/actions.ts: admin/office; copies the quote row (new number via nextNumber, status draft, cleared sent/decided/portal fields, pm_id = current profile, created_by = profile), copies sections and lines (remapping section ids; takeoff_item_id NOT copied). Returns { id }. Button "Duplicate" on the quote page header (works on any status — cloning an accepted quote into a new draft is the main use). Redirect to the new quote.

### Task A6 (Opus agent): CSV rate import

- Settings → Rates section: "Import CSV" dialog — paste/upload CSV with headers kind,name,unit,cost,default_markup_pct; preview parsed rows + validation errors; on confirm call new `importRateItems(rows)` action (admin/office, zod-validated array) that upserts by (kind, name) — update cost/markup on match, insert otherwise, never deletes. Report { added, updated }.

### Task A7 (Fable): verify + ship Phase A

- tsc, vitest --maxWorkers=1, eslint; preview click-through (draw with Backspace, preset calibrate, multiplier item, legend toggle, vertex drag, duplicate a zz quote, CSV import 2 zz rates then deactivate them); commit per feature; push; deploy; prod smoke; memory.

### Phase B (separate: migration 0049 paste → build → verify → ship)

- 0049: `alter table takeoff_sheets add column snapshot_path text; alter table quote_lines add column kind text check (kind in ('labour','plant','material','subbie','other'));`
- Plan snapshot: workspace "Save snapshot" button composites the rendered canvas + SVG overlay to a PNG client-side, uploads to attachments bucket path `takeoff-snapshots/<sheetId>.png` (overwrite = remove+upload), stores the path on the sheet; TakeoffPdf embeds each sheet's snapshot image above its section table.
- Cost breakdown: quote lines carry `kind` (set from the rate item at line-create and by pushTakeoffToQuote); QuoteBuilder totals area + quote PDF gain a by-kind cost/sell/margin table. Backfill: none (kind nullable; unknown → "other" bucket at display time).
