# PM Allocation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allocate a PM (office-side owner) to each quote, carried through conversion to the job/project, with a "Mine" filter on the quotes/jobs/projects lists.

**Architecture:** Mirror the existing `supervisor_id` pattern exactly — a nullable `pm_id → profiles(id)` column on quotes, jobs and projects; pickers in the same dialogs that pick supervisors; list columns + a `?pm=me` searchParam filter alongside the existing status filter links. PM is display/filter only — no permission changes. New quotes default the PM to the creator (server-side, in `createQuote`).

**Tech Stack:** Next.js 16 server actions + zod, Supabase (migration applied by USER pasting into dashboard SQL editor), Base UI Select pattern already used for supervisor pickers.

**Decisions locked with owner (2026-07-09):**
- PM is a separate role from Supervisor (PM = desk/commercial, Supervisor = site/phone).
- Scope = label + "Mine" filtering only. No dashboards, notifications or access restriction.
- Everyone keeps full visibility; the filter is optional.
- Pickable PMs = active profiles with role admin or office.
- Existing rows stay unassigned (no backfill).

---

### Task 1: Migration + zod + convert + createQuote default (Fable, inline)

**Files:**
- Create: `supabase/migrations/0047_pm_allocation.sql`
- Modify: `src/lib/zod.ts` (quoteCreateSchema, quoteHeaderSchema, jobCreateSchema, jobUpdateSchema, projectCreateSchema, projectUpdateSchema)
- Modify: `src/lib/convert.ts` (jobPayloadFromQuote, projectPayloadFromQuote)
- Modify: `src/app/(office)/quotes/actions.ts` (createQuote)
- Test: `tests/convert.test.ts`

- [ ] **Step 1: Migration**

```sql
-- 0047: PM allocation — an office-side owner on quotes, carried through
-- conversion to jobs/projects. Display/filter only; separate from the
-- site-facing supervisor_id.
alter table quotes add column pm_id uuid references profiles(id);
alter table jobs add column pm_id uuid references profiles(id);
alter table projects add column pm_id uuid references profiles(id);
```

USER pastes into the dashboard SQL editor with the schema_migrations bookkeeping row. Code must not be pushed to main until applied.

- [ ] **Step 2: zod** — add to each listed schema, mirroring the existing supervisor_id shape:

```ts
pm_id: z
  .uuid()
  .nullish()
  .transform((v) => v ?? null),
```

(In the two update-style schemas — quoteHeaderSchema, jobUpdateSchema, projectUpdateSchema — append `.optional()` after the transform, exactly like supervisor_id there.)

- [ ] **Step 3: convert.ts** — both payload builders copy `pm_id: quote.pm_id ?? null`. (Quotes have no supervisor, so nothing else carries.)

- [ ] **Step 4: createQuote** — insert `pm_id: parsed.data.pm_id ?? profile.id` (default to creator when the dialog sends nothing).

- [ ] **Step 5: tests** — extend tests/convert.test.ts fixture quote with `pm_id: 'some-uuid'` and assert both payloads carry it; run `npx vitest run tests/convert.test.ts --maxWorkers=1`.

- [ ] **Step 6: Commit** `feat: pm_id schema, conversion carry and quote-create default`

### Task 2: Quotes UI (Opus subagent, no commit)

**Files:**
- Modify: `src/app/(office)/quotes/new-quote-dialog.tsx` — PM Select (admin/office profiles, default = current user, "No PM" sentinel allowed) mirroring the site/contact Select pattern already in the dialog; include `pm_id` in the createQuote payload.
- Modify: `src/app/(office)/quotes/page.tsx` — fetch active admin/office profiles + current profile id, pass to dialog and table; join `profiles!quotes_pm_id_fkey(id, full_name)`; support `?pm=me` searchParam (adds `.eq('pm_id', profile.id)`); render a "Mine" filter link alongside the existing status filter links, preserving the status param.
- Modify: `src/app/(office)/quotes/quotes-table.tsx` — PM column (full name or —).
- Modify: `src/app/(office)/quotes/[id]/page.tsx` + quote-builder header area — display PM and allow changing it (Select calling updateQuoteHeader with `pm_id`), only while the quote is editable.

### Task 3: Jobs + Projects UI (Opus subagent, no commit)

**Files:**
- Modify: `src/app/(office)/jobs/new-job-dialog.tsx` and `src/app/(office)/jobs/[id]/edit-job-dialog.tsx` — PM Select directly below the existing Supervisor Select, same component pattern, options = admin/office profiles.
- Modify: `src/app/(office)/jobs/actions.ts` — map `pm_id: parsed.data.pm_id` in create/update inserts (schema handled by Task 1).
- Modify: `src/app/(office)/jobs/page.tsx` — join `profiles!jobs_pm_id_fkey`, PM column, `?pm=me` "Mine" filter link preserving status param; pass PM options where the new-job dialog is rendered.
- Modify: `src/app/(office)/jobs/[id]/page.tsx` — fetch + display PM next to supervisor.
- Modify: `src/app/(office)/projects/new-project-dialog.tsx`, `src/app/(office)/projects/actions.ts`, `src/app/(office)/projects/page.tsx`, `src/app/(office)/projects/[id]/layout.tsx` — same four changes for projects (dialog select, action mapping, list column + Mine filter, header display). If projects have an edit-settings surface where supervisor is editable, add PM there too; otherwise dialog-only is fine.

### Task 4: Verification & ship (Fable, inline)

- [ ] Review both agent diffs, fix, `npx tsc --noEmit`, `npx vitest run --maxWorkers=1`, `npx eslint src`
- [ ] Preview click-through: create quote as admin (PM defaults to Entice Admin), change PM, Mine filter on all three lists, convert a zz quote → job and confirm PM carried, clean up zz rows
- [ ] Hand 0047 paste to user; after "done", push, poll Vercel, prod smoke
- [ ] Append memory entry
