# Maintenance Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-property maintenance log — field crew record make-safes/repairs/maintenance with photo evidence, admin/office edit/flag/resolve, clients see the timeline (with open "make-safe in place" badges) on the portal.

**Owner decisions (2026-07-12):** option 2 semantics (timeline + open/resolved per entry — a temporary make-safe stays flagged until resolved); recorded by field crew AND office; admin can edit + flag issues; visible to admin and client; entries link to the job/project that did the work.

**Architecture:** `maintenance_entries` (site-scoped, RLS: all staff read+insert, admin/office update/delete) + evidence via the existing attachments system (`parent_type='maintenance'`, portal visibility rides the ENTRY's client_visible — not per-photo). Portal reads via the existing SECURITY DEFINER RPCs: `portal_site_detail` gains a `maintenance` array and `portal_file_path` gains a maintenance-attachment entitlement, both gated to `scope='full'` links (register-scope links never see maintenance). Shared server actions in `src/lib/maintenance.ts` ('use server', same pattern as attachments.ts) so office and field both call them.

---

### Task 1 (Fable, inline): migration 0051 + zod + attachments registry + shared actions

- `supabase/migrations/0051_maintenance_log.sql`: table (site_id FK cascade, kind check make_safe/repair/maintenance/inspection, title, description, done_at date, status open/resolved, follow_up, flagged+flag_note, job_id/project_id set-null FKs, client_visible default true, created_by/at, updated_at), index (site_id, done_at desc), RLS as above; `portal_site_detail` recreated FROM THE 0028 TEXT + maintenance array (client_visible entries + their attachments, newest first, scope='full' only); `portal_file_path` recreated FROM THE 0026 TEXT + maintenance branch in the attachment arm (join maintenance_entries m + sites, entry client_visible AND l.scope='full'; note per-photo client_visible NOT required for maintenance).
- zod: `MAINTENANCE_KINDS`, `maintenanceEntrySchema` (+ update variant with optional fields incl. status/flagged/flag_note).
- attachments.ts: add `maintenance: 'maintenance_entries'` to PARENT_TYPES/PARENT_TABLE.
- `src/lib/maintenance.ts` ('use server'): createMaintenanceEntry (any staff role; validates site exists + optional job/project belong to the same site or at least exist), updateMaintenanceEntry / resolveMaintenanceEntry / setMaintenanceFlag / deleteMaintenanceEntry (admin/office), all revalidating the site page + portal is RPC-read so nothing to revalidate.

### Task 2 (Opus agent, no commit): office UI

- Site page (clients/[id]/sites/[siteId]/page.tsx + a new maintenance-section.tsx client component, archetype = the compliance section on that page): timeline list (kind badge, done date, title/description, OPEN chip amber w/ follow_up text, flagged marker w/ note, evidence thumbnails via fetchAttachmentsWithUrls + AttachmentList or lightweight img row, linked job/project links), Add entry dialog (kind/title/description/date/temporary-checkbox→status open+follow_up/job-project selects scoped to the site/client_visible toggle/PhotoUpload parentType 'maintenance' after create — two-step: create then upload in the edit view, mirroring how compliance evidence works), Edit dialog, Resolve button, Flag toggle+note (admin/office).
- Job page + project overview: "Maintenance log" card listing entries where job_id/project_id matches (read-only, links to the site page section).

### Task 3 (Opus agent, no commit): field + portal UI

- Field: `/field/maintenance` page + nav entry alongside photo/waste (archetype = field/photo/page.tsx): site picker (from client sites of today's assignments first, else all sites picker matching how photo targets work — if photo page targets jobs/projects, adapt: pick job/project assignment → derive site, plus optional direct site pick), kind, title, description, done date default today, "temporary — needs permanent repair" checkbox (→ status open + follow_up default text), submit via createMaintenanceEntry then PhotoUpload for evidence.
- Portal: Maintenance tab on the site detail (archetype = the works tab in portal-ui/sites page): timeline from site_detail.maintenance, open entries badged "Make-safe in place — permanent repair recommended" (or the entry's follow_up), photos via /portal/[token]/file/attachment/[id], hidden entirely for register-scope links (client-side gate like other non-compliance tabs) and when the array is empty show a friendly empty state. Property list badge: open-count per site if site list data allows cheaply; skip if it needs an RPC change.

### Task 4 (Fable): review, tsc/vitest/lint, hand 0051 paste, click-verify live after paste (office add/edit/flag/resolve on a zz entry vs MBBC site? use a zz site or clean up entry after; field create as field1 user; portal tab via captured token; register link must NOT show it), push after applied, deploy, prod smoke, memory.
