# SWMS Title Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issuing a template SWMS from a job/project pre-fills a title page (client, principal contractor, job ref, site address, work dates, client contact) from portal data, snapshots it on the instance, and renders it as a PDF cover page and an on-screen block.

**Architecture:** New nullable `swms_instances.title_page` jsonb. A pure module `src/lib/swms-title-page.ts` owns the schema, labels, parser and the prefill builder. Pages load client/site/contacts and pass a prefill into the existing `AddSwmsDialog`; `parseSwmsStructure` exposes `titlePage` so the PDF route, field page and `SwmsFullView` pick it up.

**Tech Stack:** Next.js (app router, server actions), Supabase, zod, date-fns, @react-pdf/renderer, vitest.

Spec: `docs/superpowers/specs/2026-10-02-swms-title-page-design.md`

## Global Constraints

- `title_page = null` (pre-feature rows, uploaded-PDF SWMS) → PDF and views render exactly as today.
- Uploaded-PDF SWMS untouched.
- Migration must be applied to prod BEFORE deploying code: `SWMS_STRUCTURE_COLUMNS` will select `title_page`.
- Base UI `<Select>`: pass `items` so `SelectValue` shows labels (see `src/components/ui/select.tsx`), as other selects in the repo do.

---

### Task 1: Title-page module + migration

**Files:**
- Create: `supabase/migrations/0069_swms_title_page.sql`
- Create: `src/lib/swms-title-page.ts`
- Test: `tests/swms-title-page.test.ts`

**Produces:**
- `swmsTitlePageSchema`, `type SwmsTitlePage`, `EMPTY_SWMS_TITLE_PAGE`, `SWMS_TITLE_PAGE_LABELS: Record<keyof SwmsTitlePage, string>`
- `parseTitlePage(value: unknown): SwmsTitlePage | null` (null when missing/invalid/all blank)
- `type TitlePageContactOption = { id; name; role; phone; email }` (strings / null)
- `type TitlePageSource = { parentRef: string; client: {name; address} | null; site: {address; suburb; state; postcode} | null; start: string | null; end: string | null; contacts: TitlePageContactOption[] }`
- `type SwmsTitlePagePrefill = { values: SwmsTitlePage; contacts: TitlePageContactOption[]; contactId: string | null }`
- `buildSwmsTitlePagePrefill(src: TitlePageSource): SwmsTitlePagePrefill`
- `formatWorkDates(start, end): string`, `formatSiteAddress(site): string`

- [ ] Migration:

```sql
-- SWMS title page: client / job / site / contact snapshot taken at issue.
-- Null on rows issued before this and on uploaded-PDF SWMS.
alter table swms_instances add column title_page jsonb;
```

- [ ] Write failing tests (site vs client-address fallback vs none; dates both/start-only/end-only/none formatted `d MMM yyyy`; 0/1/many contacts — one contact auto-picked; parseTitlePage null/blank/valid).
- [ ] Implement module; run `npx vitest run tests/swms-title-page.test.ts` → PASS.
- [ ] Commit.

### Task 2: Schema, action, structure parse

**Files:** Modify `src/lib/swms.ts`, `src/lib/swms-actions.ts`; Test `tests/swms.test.ts`

- [ ] `swmsInstanceCreateV2Schema` gains `title_page: swmsTitlePageSchema.default(EMPTY_SWMS_TITLE_PAGE)`.
- [ ] `SwmsStructure` gains `titlePage: SwmsTitlePage | null`; `parseSwmsStructure` accepts `title_page?: unknown` and sets `titlePage: parseTitlePage(row.title_page)`.
- [ ] `SWMS_STRUCTURE_COLUMNS` appends `, title_page`.
- [ ] `createSwmsInstance` inserts `title_page: parsed.data.title_page`.
- [ ] Tests: create schema keeps a supplied title_page and defaults it; parseSwmsStructure returns `titlePage` null when absent, populated when present. Run `npx vitest run tests/swms.test.ts` → PASS. Commit.

### Task 3: Issue dialog + page wiring

**Files:** Modify `src/components/SwmsInstancesSection.tsx`, `src/app/(office)/jobs/[id]/page.tsx`, `src/app/(office)/projects/[id]/whs/page.tsx`

- [ ] `SwmsInstancesSection` / `AddSwmsDialog` take optional `titlePagePrefill?: SwmsTitlePagePrefill` (fallback: empty values, no contacts).
- [ ] Dialog state `titlePage` + `contactId` initialised from prefill; `reset()` restores prefill.
- [ ] "Title page" section (after template picker, shown once a template is picked): contact `<Select>` (`name — role`, plus "Type manually" = `__manual`) that fills name/phone/email; inputs for all 8 fields.
- [ ] Hide `work_dates` and `client_contact` from the project-details inputs (`HIDDEN_AT_ISSUE` set).
- [ ] Submit passes `title_page: titlePage`.
- [ ] Job page: jobs select → `clients(id, name, address, contacts(id, name, role, phone, email))`, `sites(id, name, address, suburb, state, postcode)`; build prefill with `parentRef: \`${job.number} — ${job.title}\``, `start: job.scheduled_start`, `end: job.scheduled_end`.
- [ ] Project WHS page: projects select → `id, number, name, start_date, clients(name, address, contacts(id, name, role, phone, email)), sites(address, suburb, state, postcode)`; `start: project.start_date`, `end: null`.
- [ ] `npx tsc --noEmit` clean. Commit.

### Task 4: PDF cover page + on-screen block

**Files:** Modify `src/pdf/SwmsPdf.tsx`, `src/app/api/pdf/[type]/[id]/route.tsx`, `src/components/SwmsFullView.tsx`; Test `tests/swms-pdf.test.tsx`

- [ ] `SwmsPdfProps.titlePage?: SwmsPdfRow[]`. When non-empty: cover block (heading "Safe Work Method Statement", SWMS title, `SectionTable title="Title page"` of rows, "Version vN · Issued <date>"), then `<View break />`.
- [ ] Route passes `titlePage={structure.titlePage ? labelValueRows(SWMS_TITLE_PAGE_LABELS, structure.titlePage) : []}`.
- [ ] `SwmsFullView`: when `structure.titlePage`, first section "Title page" with `LabelValueList labels={SWMS_TITLE_PAGE_LABELS}`.
- [ ] Test renders SwmsPdf with and without titlePage → `%PDF-`. Run full `npx vitest run` + `npx tsc --noEmit`. Commit.

### Task 5: Apply migration, verify, ship

- [ ] Apply 0069 to prod (additive nullable column) with a `schema_migrations` row, after owner OK.
- [ ] Dev server: open a job → Add SWMS → template → title page prefilled; issue; open PDF → cover page; open an older SWMS PDF → unchanged.
- [ ] Push to main (deploys).
