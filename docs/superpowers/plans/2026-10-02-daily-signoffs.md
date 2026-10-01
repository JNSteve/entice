# Daily Field Sign-offs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crew log materials/plant/subbies per day; a frozen daily snapshot is built (overnight or on demand), the PM reviews and releases it to the client portal, and the client signs or disputes lines; every version is kept on the job/project.

**Architecture:** Migration 0068 adds `field_usage`, `field_day_notes`, `daily_signoffs` (+ lines, responses), price-free field picker RPCs and anon portal RPCs. A pure module (`src/lib/signoffs.ts`) turns source rows into snapshot lines; a server module (`src/lib/signoff-build.ts`) loads sources and writes drafts (used by the PM action and the 6 am cron). Office review lives at `/signoffs/[id]`; registers sit on the job page and a new project tab; the portal gets a list on the work page/approvals and a sign page.

**Tech Stack:** Next 16.2.9 (app router, server actions), Supabase (RLS + SECURITY DEFINER RPCs), @react-pdf/renderer, Resend via `src/lib/email.ts`, vitest.

Spec: `docs/superpowers/specs/2026-10-01-daily-signoffs-design.md`

## Global Constraints

- Quantities only — no rates or dollar values anywhere on the sheet, portal or PDF.
- Nothing reaches the client until an admin/office user (the PM pool — `pm_id` only ever points at admin/office profiles) clicks **Release to client**.
- No automatic client reminders; no on-site signing.
- Brisbane dates via `src/lib/tz.ts` (`todayAU`, `yesterdayAU`, `dateAU`).
- Anon access only through the 0068 RPCs (`portal_live_link` guard); never add anon table policies.
- Raw `<input>/<select>/<textarea>` use `text-base md:text-sm` (iOS focus-zoom rule).
- Next 16 JSX drops the space after `{expr}` on the same line — use template literals for mixed text.
- Migrations are applied by the owner pasting SQL into the Supabase dashboard (plus a `supabase_migrations.schema_migrations` row).
- Test data must be `zz`-prefixed and cleaned up; rewind `sequences` key `work_number:26` if zz works are created.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0068_daily_signoffs.sql` | Tables, RLS, freeze triggers, field + portal RPCs (written) |
| `src/lib/signoffs.ts` | Pure: types, `buildSnapshotLines`, `sourceHash`, `validateDisputes`, labels |
| `tests/signoffs.test.ts` | Unit tests for the pure module |
| `src/lib/signoff-build.ts` | Server: load sources, build/rebuild draft, overnight batch, current hash |
| `src/lib/signoff-actions.ts` | `'use server'` office actions (build, edit lines, release, revise, delete) |
| `src/lib/notify.ts` / `src/lib/email.ts` | `client_signoff_released`, `office_signoff_response` |
| `src/app/api/cron/notify/route.ts` | Calls `buildYesterdayDrafts(admin)` |
| `src/app/field/usage/{page.tsx,usage-client.tsx,actions.ts}` | Field "Used today" screen |
| `src/app/field/my-day-client.tsx` | Link from each assignment card |
| `src/components/signoffs/SignoffRegister.tsx` (+ `BuildSignoffForm.tsx`) | Register list + build-a-day form |
| `src/app/(office)/jobs/[id]/page.tsx` | Sign-offs section |
| `src/app/(office)/projects/[id]/signoffs/page.tsx` + `project-tabs.tsx` | Sign-offs tab |
| `src/app/(office)/signoffs/page.tsx` | Cross-job queue (To release / Awaiting client / Disputed / Signed) |
| `src/app/(office)/signoffs/[id]/{page.tsx,signoff-editor.tsx}` | Review, edit, release, revise |
| `src/app/(office)/office-shell.tsx` | Nav item |
| `src/pdf/DailySignoffPdf.tsx`, `src/pdf/build-signoff-pdf.tsx` | PDF |
| `src/app/api/pdf/[type]/[id]/route.tsx` | `case 'signoff'` |
| `src/app/portal/[token]/signoffs/[id]/{page.tsx,signoff-respond.tsx}` | Client sign/dispute |
| `src/app/portal/[token]/signoff-pdf/[id]/route.tsx` | Token-gated PDF |
| `src/app/portal/[token]/actions.ts` | `respondPortalSignoff` |
| `src/app/portal/[token]/portal-ui.tsx` | `PortalSignoffRow`, `PortalSignoffDetail` types + `SignoffList` |
| portal `approvals/page.tsx`, `works/[kind]/[id]/page.tsx` | List sign-offs |

---

### Task 1: Migration 0068 (done — owner applies)

**Files:** Create `supabase/migrations/0068_daily_signoffs.sql` (written).

- [ ] Owner pastes the file into the Supabase SQL editor, then:
```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
values ('0068', 'daily_signoffs', array[]::text[]);
```
- [ ] Verify: `select count(*) from daily_signoffs;` returns 0 and `select field_catalogue_search('ab');` runs.

### Task 2: Pure snapshot module

**Files:** Create `src/lib/signoffs.ts`, `tests/signoffs.test.ts`.

**Produces:**
```ts
export type SignoffSection = 'labour' | 'subbie' | 'plant' | 'material'
export type SignoffStatus = 'draft' | 'released' | 'signed' | 'disputed' | 'superseded'
export type TimesheetSource = { id: string; user_id: string; full_name: string; start_at: string; end_at: string | null; approved: boolean }
export type UsageSource = { id: string; kind: 'material' | 'plant' | 'subbie'; description: string; qty: number | null; unit: string | null; company: string | null; headcount: number | null; hours: number | null; scope_label: string | null; updated_at: string }
export type SnapshotLine = { sort: number; section: SignoffSection; description: string; qty: number; unit: string; detail: string | null; scope_label: string | null; flags: string[]; source: Record<string, unknown> }
export const LONG_SHIFT_HOURS = 12
export function roundQuarter(hours: number): number
export function buildSnapshotLines(input: { timesheets: TimesheetSource[]; usage: UsageSource[] }): SnapshotLine[]
export function sourceHash(input: { timesheets: TimesheetSource[]; usage: UsageSource[] }): string
export type DisputeInput = { line_id: string; client_qty: number; reason: string }
export function validateDisputes(raw: unknown, lineIds: ReadonlySet<string>): { ok: true; disputes: DisputeInput[] } | { error: string }
export const SIGNOFF_STATUS_LABELS: Record<SignoffStatus, string>
export const SIGNOFF_SECTION_LABELS: Record<SignoffSection, string>
export const FLAG_LABELS: Record<string, string>
```

Rules: labour = one line per user (sorted by name), qty = Σ closed hours rounded to 0.25, unit `hrs`, detail = Brisbane time ranges (`07:00–15:30`, open entries `07:00–(still on site)`), flags `still_checked_in` / `unapproved` / `long_shift` (> 12 h), source `{timesheet_entry_ids}`. Subbie: description = company, qty = headcount × hours, unit `man-hrs`, detail `N people × H h`. Plant: qty, unit default `hrs`. Material: qty + unit (default `ea`). Usage keeps input order within its section. Sections ordered labour → subbie → plant → material; `sort` = index × 10. `sourceHash` = sha256 hex of a canonical JSON of sorted timesheet `(id,start_at,end_at,approved)` + usage `(id,updated_at)`.

- [ ] Write failing tests (grouping, rounding, open entry, long shift, unapproved, subbie maths, section order, hash stability/ordering-independence/change detection, dispute validation: unknown line, duplicate, negative, empty reason, >500 chars, ok case).
- [ ] `npx vitest run tests/signoffs.test.ts` → FAIL.
- [ ] Implement; re-run → PASS. Commit.

### Task 3: Build module + office actions + cron

**Files:** Create `src/lib/signoff-build.ts`, `src/lib/signoff-actions.ts`; modify `src/app/api/cron/notify/route.ts`.

**Produces:**
```ts
// signoff-build.ts (server-only, takes any SupabaseClient)
export type WorkRef = { kind: 'job' | 'project'; id: string }
export async function loadSnapshotSource(sb, work: WorkRef, date: string): Promise<{ timesheets: TimesheetSource[]; usage: UsageSource[]; summary: string }>
export async function buildSignoffDraft(sb, work: WorkRef, date: string, builtBy: string | null): Promise<{ id: string } | { error: string }>
export async function buildYesterdayDrafts(admin): Promise<{ built: number; skipped: number; errors: string[] }>
export async function currentSourceHash(sb, work: WorkRef, date: string): Promise<string>
// signoff-actions.ts ('use server', requireRole('admin','office'))
buildSignoff(kind, id, date) · updateSignoffLine(lineId, {description, qty, unit, detail, scope_label}) · addSignoffLine(signoffId, {section, description, qty, unit, detail}) · deleteSignoffLine(lineId) · updateSignoffDraft(id, {summary, photo_ids}) · releaseSignoff(id) · reviseSignoff(id) · deleteSignoffDraft(id)
→ Promise<{ error?: string; id?: string }>
```

Rules: build creates v1 when no row exists for (work, date); rebuilds a `draft` in place (replace lines, refresh summary + hash, keep photo_ids); refuses when the live version is released/signed ("already released"); when the latest is `disputed` it refuses ("use Revise"). Summary = project diary `work_performed` if non-empty else `field_day_notes.summary`. Release: status-guarded `draft → released`, refuses with no lines, any `still_checked_in` flag, or no live full-scope client link; sets chosen photos `client_visible = true`; marks the `supersedes_id` row `superseded`; fires `notifyClientSignoffReleased` via `after()`. Revise (from `disputed` only): new draft `version+1`, `supersedes_id`, lines copied, disputed lines' qty = client figure + flag `client_figure`. Cron: overnight run builds drafts for yesterday for every work with timesheet entries or usage and no sign-off row for that date.

- [ ] Implement; `npx tsc --noEmit` clean; commit.

### Task 4: Emails

**Files:** Modify `src/lib/email.ts` (2 template keys + labels), `src/lib/notify.ts` (`notifyClientSignoffReleased({signoffId})` office context; `notifyOfficeSignoffResponse({token, signoffId})` anon context using `portal_signoff`), `tests/email.test.ts` (contain checks).

- [ ] Implement, test, commit.

### Task 5: Field "Used today"

**Files:** Create `src/app/field/usage/{page.tsx,usage-client.tsx,actions.ts}`; modify `src/app/field/my-day-client.tsx` (link on each assignment card: `/field/usage?job=…` / `?project=…`).

Page: `?job|project=<id>&date=<YYYY-MM-DD>` (date defaults today; toggle today/yesterday). Loads work header, `field_usage_options`, that day's `field_usage` rows (all crew, own rows editable), `field_day_notes`. Client: tabs Material / Plant / Subbie; material picker shows scope lines first, then price-list search (`field_catalogue_search`, debounced), then free text; qty + unit; plant from register + hours; subbie company + headcount + hours. Summary textarea saved with a button. Actions validate with zod, `getProfile()`, write via the user's client (RLS enforces the window).

- [ ] Implement; click-verify on localhost as field1@; commit.

### Task 6: Office register, queue, review page, nav, project tab

**Files:** see file map. Register rows: date, version, status badge, released/answered dates, days awaiting, "source changed" badge (released/signed rows whose `currentSourceHash` ≠ stored), link to `/signoffs/[id]`. `BuildSignoffForm`: date input (default yesterday) → `buildSignoff` → navigate to the new id. Review page: header, summary editor, lines grouped by section (inline edit when draft and admin/office), add-line row, photo picker (that day's job/project photos + project diary photos), buttons Rebuild / Release to client / Delete draft / Revise / PDF; response block (signer, date, signature image, disputes table our qty vs client qty + reason); version history links. Supervisors see read-only.

- [ ] Implement; click-verify as admin; commit.

### Task 7: PDF

**Files:** Create `src/pdf/DailySignoffPdf.tsx` (DocShell; archetype `src/pdf/DiaryPdf.tsx` for photos), `src/pdf/build-signoff-pdf.tsx` (`buildSignoffPdfResponse(sb, id, {watermark})`); add `case 'signoff'` to `src/app/api/pdf/[type]/[id]/route.tsx` (admin/office/supervisor).

- [ ] Implement; render test in `tests/signoff-pdf.test.tsx` (renders to buffer with signed + disputed fixtures); commit.

### Task 8: Portal

**Files:** see file map. Approvals page: "Daily sign-offs awaiting you" (status `released`). Work page: "Daily sign-offs" list (all statuses, newest first). Sign page: lines by section with a "Dispute" toggle per line (their qty + reason), summary, photos (`PhotoGallery`), name + `SignaturePad`, wording "I confirm the labour, plant and materials above for {date}, except any lines I have disputed." Submit → `respondPortalSignoff` → `portal_signoff_respond` → `after(notifyOfficeSignoffResponse)`. Answered sheets show the outcome; superseded ones link to the replacement. PDF route mirrors `approval-pdf`.

- [ ] Implement; verify with the Nick Jones test link; commit.

### Task 9: Verify + ship

- [ ] `npx tsc --noEmit`, `npx vitest run --maxWorkers=1`, `npm run lint`.
- [ ] Live proof on a zz job: field logs time + usage → build → edit → release → portal sign with one dispute → revise → v2 → clean sign → both PDFs; other-client token gets null; double submit → not_acceptable. Clean up.
- [ ] Update memory; push to main (owner confirms).
