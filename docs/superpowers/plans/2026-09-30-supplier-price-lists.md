# Supplier Price Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Import supplier price lists (xlsx/csv/PDF) into `rate_items`, pick items when adding job costs, and optionally add an imported document's lines to a job.

**Architecture:** Pure matching/normalising logic in `src/lib/price-list.ts` (tested); OpenAI PDF extraction in `src/lib/extract-price-list.ts`; server actions in `src/lib/price-list-actions.ts`; a shared `PriceListImport` client component used from Settings and the job P&L; the cost dialog gains a category picker + item search.

**Tech Stack:** Next.js 16, Supabase, zod 4, OpenAI `responses` API (gpt-5, strict JSON schema), `read-excel-file`, vitest.

Spec: `docs/superpowers/specs/2026-09-30-supplier-price-lists-design.md`

## Global Constraints

- Stored prices are ex GST; `rate_items.cost` 4 dp, cost `amount` 2 dp via `round2`.
- Admin/office only for every action; money tables RLS unchanged.
- `RATE_KINDS` (quote/invoice lines) unchanged; `PRICE_KINDS` = RATE_KINDS + `consumable`; consumable → `material` on quote lines.
- Migration applied by the owner in the SQL editor **before** deploy.

---

### Task 1: Migration 0067 — `supabase/migrations/0067_price_lists.sql`
- [ ] rate_items columns + kind check + cost numeric(12,4) + index; costs columns + checks; supplier_import_mappings + RLS; schema_migrations row in the paste file.

### Task 2: Pure logic — `src/lib/price-list.ts` + `tests/price-list.test.ts`
- [ ] `PRICE_KINDS`, `kindToCategory`, `quoteKind`, `normaliseSupplier`, `toExGst`, `rowsFromTable(table, mapping, opts)`, `diffAgainstExisting(rows, existing)` (match code then name; statuses new/changed/unchanged), `detectPricesIncludeGst(lines, subtotal, gst)`.
- [ ] P&L: `CostCategory` + `consumables`; `costCategory(source, codeCategory, rowCategory?)`; loaders pass `costs.category`.

### Task 3: PDF extraction — `src/lib/extract-price-list.ts`
- [ ] Strict schema {supplier, document_date, subtotal, gst, lines[{code,name,unit,qty,unit_price,kind,note}]}; prompt drops zero-price/freight/serial/note lines into notes; reuse error mapping pattern from `extract-quote-template.ts`.

### Task 4: Server actions — `src/lib/price-list-actions.ts`
- [ ] `searchPriceItems(query, kinds)`, `extractPriceListPdf({path, filename})`, `loadSupplierMapping(supplier)`, `commitPriceListImport(payload)` (upsert, deactivate missing, save mapping, optional job costs), quote-line kind mapping in `quotes/actions.ts` + takeoff.

### Task 5: UI
- [ ] `src/components/price-list/PriceListImport.tsx` (source → map → review → commit).
- [ ] Settings rates: supplier/code columns, supplier filter, consumable, Import button.
- [ ] Cost dialog: category picker + `ItemSearch`, qty × unit price, "Import supplier document" button on cost lines.
- [ ] Quote rate picker label for consumable.

### Task 6: Verify & ship
- [ ] Tests, tsc, build; review; migration SQL to owner; push after it's applied; owner test with the Allens proforma on live.
