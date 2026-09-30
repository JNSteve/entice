# Supplier price lists & catalogue costs — design

**Date:** 2026-09-30 · **Status:** approved by owner in chat
**Builds on:** job P&L (`2026-09-29-job-project-pnl-design.md`)

## Goal

Load supplier price lists (Allens, Bunnings, …) from spreadsheets or PDFs
(price lists, quotes, proformas, invoices) into the existing rate library, and
pick those items when adding a cost to a job so qty × price fills in. Optionally
add an imported document's lines straight onto a job's costs.

## Decisions (owner)

- Import both **spreadsheets (.xlsx/.csv)** and **PDFs** (AI extraction).
- Build on `rate_items` — one price list feeds quoting and job costing.
- Review screen has two independent ticks per line: **Save to price list** and
  **Add to job costs** (reusable equipment on an invoice goes to the price list
  only).

## Data — migration 0067

- `rate_items`: add `supplier text`, `product_code text`, `notes text`,
  `updated_at timestamptz default now()`; kind check adds `consumable`; `cost`
  widened to `numeric(12,4)` (Allens prices to 4 dp). Index on
  `(lower(supplier), lower(product_code))`.
- `costs`: add `category text` check in
  (`labour`,`plant`,`materials`,`consumables`,`subcontract`,`other`),
  `rate_item_id uuid → rate_items on delete set null`, `qty numeric(12,3)`,
  `unit_cost numeric(12,4)`.
- `supplier_import_mappings` (new): `supplier_key text pk` (lower-cased
  supplier), `supplier text`, `mapping jsonb`, `updated_at`. RLS admin/office.

`consumable` exists only on `rate_items` (`PRICE_KINDS`); `RATE_KINDS`
(quote/invoice lines) is unchanged and a consumable becomes `material` when it
is copied onto a quote line.

## P&L category

`CostCategory` gains `consumables` ("Consumables"); "Materials & consumables"
becomes "Materials". A cost row's category = `costs.category` if set, else its
cost code's category, else `labour` for labour rows, else `other`. Rate kind →
category: material→materials, consumable→consumables, plant→plant,
subbie→subcontract, labour→labour, other→other.

## Import flow (Settings → Rates & price lists → Import; also "Import supplier
document" on a job's cost lines, job preselected)

1. **Source:** pick a file. `.xlsx`/`.csv` are parsed in the browser
   (`read-excel-file` for xlsx, existing CSV handling); `.pdf` uploads to the
   `attachments` bucket (`price-lists/` prefix) and a server action runs OpenAI
   extraction (`gpt-5`, strict JSON schema), then the upload is removed.
2. **Spreadsheet only — map columns:** Name, Cost, Unit, Product code, Type
   (or one type for the whole file), Qty (optional). Remembered per supplier.
3. **Review table:** per line — Save to price list ☑, Add to job ☐, code, name,
   type, unit, unit price (ex GST), qty, and a status badge (New / Price change
   old → new / Unchanged). Supplier field (auto-detected from PDFs), **Prices
   include GST** switch (PDF: detected from subtotal + GST vs line totals),
   optional "Deactivate this supplier's items not in this list". Zero-price
   lines and notes are dropped by extraction (notes kept on the item).
4. **Commit (one server action):** upsert selected price-list lines (match
   supplier + product code, else supplier + name, case-insensitive; update
   cost/unit/kind/notes/updated_at), optionally deactivate missing, save the
   mapping; if a job is chosen, insert the "Add to job" lines as `costs`
   (`source 'manual'`, category from type, `rate_item_id`, qty, unit_cost,
   amount = round2(qty × unit_cost), date = document date or today).
   Returns counts.

Prices are stored ex GST (inc-GST input divided by 1 + rate).

## Adding a cost (job/project Costs & P&L → Add cost → Other cost)

Category picker (Materials · Consumables · Plant & equipment · Subcontract ·
Other). For all but Other an **item search** (server action, `ilike` on name /
code / supplier, active items of the matching kind(s), 30 results) with
"Custom item". Picking fills description + unit price; qty × unit price →
amount (editable via the Inc/Ex GST input). Saves `category`, `rate_item_id`,
`qty`, `unit_cost`.

## Rates list

Adds Supplier and Code columns, supplier filter, and the Consumable type.

## Out of scope

Price history, per-supplier discount rules, auto-reordering.
