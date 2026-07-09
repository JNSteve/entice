# Archive Records Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Archive (hide, reversible) for quotes, jobs and projects, with a Settings → Archive tab to restore.

**Architecture:** `archived boolean not null default false` + `archived_at timestamptz` on quotes/jobs/projects (mirrors clients.archived). Archive/restore server actions per module. List and picker queries gain `.eq('archived', false)`; by-id detail fetches and mutations stay untouched so archived records remain reachable (Settings links to them) — detail pages show an "Archived" banner. Nothing is deleted; ISO-friendly.

**Decisions locked with owner (2026-07-09):**
- Archive over hard delete (auditor-safe, reversible; user picks records via UI, never bulk).
- Restore surface lives in Settings.
- Admin/office can archive and restore.
- Archiving is independent per record (archiving a converted quote does not touch its job, and vice versa).

---

### Task 1 (Fable, inline): migration + actions

- Create `supabase/migrations/0048_archive_records.sql`:

```sql
-- 0048: reversible archive for quotes/jobs/projects (mirrors clients.archived).
alter table quotes  add column archived boolean not null default false, add column archived_at timestamptz;
alter table jobs    add column archived boolean not null default false, add column archived_at timestamptz;
alter table projects add column archived boolean not null default false, add column archived_at timestamptz;
```

- Add `setQuoteArchived(id, archived)` to quotes/actions.ts, `setJobArchived` to jobs/actions.ts, `setProjectArchived` to projects/actions.ts: `requireRole('admin','office')`, update `{ archived, archived_at: archived ? new Date().toISOString() : null }`, revalidate the module list + detail paths + `/settings`, return `{error?}`. No editable-status guard (archive must work on frozen/converted records).
- Commit.

### Task 2 (Opus agent, no commit): list/picker filter sweep

Add `.eq('archived', false)` ONLY to queries that LIST records or feed PICKERS, in exactly these files. Never touch a `.eq('id', …).single()` detail/validation fetch. Where a query joins the table as an embed (not the root), leave it alone.

- `src/app/(office)/quotes/page.tsx` (quotes list)
- `src/app/(office)/jobs/page.tsx` (jobs list)
- `src/app/(office)/projects/page.tsx` (projects list)
- `src/app/(office)/page.tsx` (dashboard cards querying quotes/jobs/projects)
- `src/app/(office)/schedule/page.tsx` (job/project pickers + board queries)
- `src/app/(office)/clients/[id]/page.tsx` (per-client quotes/jobs/projects lists)
- `src/app/(office)/clients/[id]/sites/[siteId]/page.tsx` (per-site jobs/projects lists)
- `src/app/(office)/reports/page.tsx` (aggregates — archived test data must not pollute reports)
- `src/app/(office)/whs/env/page.tsx`, `src/app/(office)/whs/forms/page.tsx`, `src/app/(office)/whs/incidents/page.tsx`, `src/app/(office)/whs/ncr/page.tsx`, `src/app/(office)/whs/risks/page.tsx`, `src/app/(office)/whs/subbie-swms/page.tsx`, `src/app/(office)/whs/audit/page.tsx` — ONLY where they load a projects/jobs list for a picker/filter dropdown; leave detail/by-id fetches alone.
- `src/app/field/photo/page.tsx`, `src/app/field/safety/new/[templateId]/page.tsx`, `src/app/field/waste/page.tsx`, `src/app/field/diary/page.tsx` — field target pickers/lists.

Typecheck + eslint only (column not in live DB yet).

### Task 3 (Opus agent, no commit): archive buttons + Settings tab

- Archive/Restore control (confirm dialog, sonner toast) on: quote page header (quote-builder header actions or [id]/page), job page ([id]/page header), project ([id]/layout header). Show an "Archived" amber banner on these pages when archived (fetch the flag in the existing by-id select).
- Settings → "Archive" tab (mirror the estimating-section.tsx archetype): three sections (Quotes / Jobs / Projects) listing archived records (number, title/name, client, archived_at date) each with a link to the record and a Restore button calling the module's set*Archived(id, false). Load data in settings/page.tsx `Promise.all` (`.eq('archived', true)`, order archived_at desc), wire tab in settings-tabs.tsx + VALID_TABS.

### Task 4 (Fable): review diffs, tsc/vitest/lint, hand 0048 paste to user, click-verify against live DB after paste (archive J-0010 + Q-0011 + user-nominated test records via UI — USER picks real vs test), push after paste, deploy, prod smoke, memory.
