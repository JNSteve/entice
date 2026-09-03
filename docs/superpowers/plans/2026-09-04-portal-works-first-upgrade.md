# Client Portal Works-First Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing client portal so builder/contractor clients open on their works and quotes, office shares a whole job with one switch, sent quotes publish automatically, and clients receive their portal link by email.

**Architecture:** Additive upgrade of the existing token-link portal. All anon reads stay behind SECURITY DEFINER RPCs validated by `portal_live_link(token)`; office writes stay behind `requireRole('admin','office')` server actions; every portal page view goes through `portal_log_view`. New pages (`/works`, `/works/[kind]/[id]`, `/properties`) reuse `PortalShell`, `PortalCard`, the photo/doc row primitives and the existing file download gate. Email goes through `src/lib/email.ts`, which skip-logs until `RESEND_API_KEY` + `EMAIL_FROM` exist.

**Tech Stack:** Next.js 16 (App Router, `'use server'` actions, `after()`), Supabase (Postgres RPCs, Storage), Tailwind, lucide-react, sonner toasts, vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-portal-works-first-upgrade-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code (AGENTS.md) — this Next 16 differs from training data (async `params`/`searchParams`, `after()` from `next/server`).
- Portal styling: navy `#162040`, gold `#c9a868`, `PortalCard`, `rounded-xl`/`rounded-2xl`, `min-h-11` touch targets, slate text. Copy classes from neighbouring portal components.
- Any raw `<input>/<select>/<textarea>` needs `text-base md:text-sm` (iOS focus-zoom rule).
- Money NEVER appears in portal payloads except the approvals/billing pages.
- Anon never gets table access: new reads are RPCs (`security definer`, `set search_path = public`, `grant execute … to anon, authenticated`, return `null` for dead tokens).
- The migration file is committed but **applied by the owner** pasting into the Supabase SQL editor (add the `supabase_migrations.schema_migrations` row in the paste, not the file). Do not deploy until it is applied.
- Live DB is production: any test row must be named `zz…` and deleted afterwards.
- Verification: `npx tsc --noEmit`, `npm run lint`, `npx vitest run --maxWorkers=1` before every commit. Page changes need an HTTP load; dialogs/switches need a click-level check.
- Dev server needs `$env:NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-tls-npm-workaround'` (see memory) or server-side Supabase calls fail. Never run two dev servers on one `.next`.
- Handover pack caption literal is `'Handover pack'` (`HANDOVER_PACK_CAPTION` in `src/lib/feedback.ts`); the SQL mirrors it.

## File map

| File | Responsibility |
|---|---|
| `src/lib/portal.ts` | + `PortalPropertyStatus`, `derivePortalPropertyStatus`, `portalInviteMessage` (pure) |
| `src/lib/portal-experience.ts` | `propertyStatusPhrase` none-state; + work timeline constants/`workTimelineIndex` (pure) |
| `src/lib/portal-interactions.ts` | `canPublishQuote` widened to sent/accepted |
| `supabase/migrations/0062_portal_works_first.sql` | columns, backfill, RPC replacements, new RPCs |
| `src/app/portal/[token]/portal-ui.tsx` | nav (5 items), `'none'` status, `WorkTimeline`, new payload types |
| `src/app/portal/[token]/work-ui.tsx` | NEW: `PhotoGallery`, `DocRows`, `isPhoto`, `WorkCard` (moved from the site page + new) |
| `src/app/portal/[token]/page.tsx` | Overview (works-first) |
| `src/app/portal/[token]/properties/page.tsx` | NEW: today's property list |
| `src/app/portal/[token]/works/page.tsx` | NEW: all works |
| `src/app/portal/[token]/works/[kind]/[id]/page.tsx` | NEW: work page |
| `src/app/portal/[token]/sites/[siteId]/page.tsx` | uses work-ui, none-state, work links, empty copy |
| `src/app/portal/[token]/approvals/page.tsx` + `[kind]/[id]/page.tsx` | office-decided group, nav active |
| `src/app/portal/[token]/request/page.tsx`, `calendar/page.tsx` | `active` prop values |
| `src/lib/work-sharing.ts` | NEW: `setWorkClientShared` action |
| `src/lib/attachments.ts` | default `client_visible` from the shared work; diary curation |
| `src/lib/handover.ts` | pack visibility follows the work |
| `src/components/ShareWithClientSwitch.tsx` | NEW client component |
| `src/app/(office)/jobs/[id]/page.tsx`, `projects/[id]/layout.tsx`, `projects/[id]/diary/diary-list.tsx`, `clients/[id]/page.tsx`, `clients/[id]/sites/[siteId]/page.tsx` | office placements |
| `src/app/(office)/quotes/actions.ts`, `quotes/[id]/quote-builder.tsx` | auto-publish |
| `src/lib/email.ts`, `src/lib/notify.ts`, `src/lib/zod.ts`, `src/lib/client-links.ts` | templates, quote-sent + invite emails, invite action |
| `src/app/(office)/clients/[id]/portal-links.tsx` | invite step + Send action |
| `tests/portal.test.ts`, `tests/portal-experience.test.ts`, `tests/portal-interactions.test.ts`, `tests/email.test.ts` | pure-logic tests |
| `README.md` | Client portal section |

---

### Task 1: Pure logic — portal property status, work timeline, publish rule, invite message

**Files:**
- Modify: `src/lib/portal.ts`
- Modify: `src/lib/portal-experience.ts` (the `propertyStatusPhrase` function near the bottom, and after `workGroupForProject`)
- Modify: `src/lib/portal-interactions.ts:119-121`
- Test: `tests/portal.test.ts`, `tests/portal-experience.test.ts`, `tests/portal-interactions.test.ts`

**Interfaces:**
- Produces: `type PortalPropertyStatus = ComplianceStatus | 'none'`; `derivePortalPropertyStatus(reviewDues: (string|null)[], today: string): PortalPropertyStatus`; `portalInviteMessage(companyName: string, clientName: string, url: string): string`; `JOB_TIMELINE`, `PROJECT_TIMELINE`, `WORK_STEP_LABELS`, `workTimelineIndex(kind: 'job'|'project', status: string): number`; `propertyStatusPhrase` now returns `{ status: PortalPropertyStatus; phrase: string }`; `canPublishQuote` true for `'sent' | 'accepted'`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/portal.test.ts`:

```ts
import { derivePortalPropertyStatus, portalInviteMessage } from '@/lib/portal'

describe('derivePortalPropertyStatus (portal-only aggregate)', () => {
  it('no items → none (works-only clients are not red)', () => {
    expect(derivePortalPropertyStatus([], TODAY)).toBe('none')
  })

  it('otherwise mirrors derivePropertyStatus', () => {
    expect(derivePortalPropertyStatus([null], TODAY)).toBe('green')
    expect(derivePortalPropertyStatus(['2026-07-20'], TODAY)).toBe('amber')
    expect(derivePortalPropertyStatus(['2026-07-01'], TODAY)).toBe('red')
  })
})

describe('portalInviteMessage', () => {
  it('names the company, the client and the URL, and asks to keep it private', () => {
    const msg = portalInviteMessage('Entice', 'Damon Constructions', 'https://x.test/portal/abc')
    expect(msg).toBe(
      'Entice has set up a secure client portal for Damon Constructions. Open it here: https://x.test/portal/abc. Please keep this link private.'
    )
  })
})
```

Append to `tests/portal-experience.test.ts` (the file already imports from `@/lib/portal-experience`; add the new names to that import):

```ts
describe('propertyStatusPhrase', () => {
  it('no items → none with the register phrase', () => {
    expect(propertyStatusPhrase([], '2026-07-05')).toEqual({
      status: 'none',
      phrase: 'No compliance register on file',
    })
  })
})

describe('workTimelineIndex', () => {
  it('maps job statuses onto the four-step client timeline', () => {
    expect(workTimelineIndex('job', 'quote')).toBe(0)
    expect(workTimelineIndex('job', 'scheduled')).toBe(1)
    expect(workTimelineIndex('job', 'in_progress')).toBe(2)
    expect(workTimelineIndex('job', 'completed')).toBe(3)
    expect(workTimelineIndex('job', 'invoiced')).toBe(3)
    expect(workTimelineIndex('job', 'paid')).toBe(3)
    expect(workTimelineIndex('job', 'lost')).toBe(-1)
  })

  it('maps project statuses onto their four steps', () => {
    expect(workTimelineIndex('project', 'active')).toBe(0)
    expect(workTimelineIndex('project', 'practical_completion')).toBe(1)
    expect(workTimelineIndex('project', 'defects_liability')).toBe(2)
    expect(workTimelineIndex('project', 'closed')).toBe(3)
    expect(workTimelineIndex('project', 'junk')).toBe(-1)
  })
})
```

Append to `tests/portal-interactions.test.ts` (add `canPublishQuote` to its import):

```ts
describe('canPublishQuote', () => {
  it('sent and accepted quotes can sit on the portal; drafts and lost cannot', () => {
    expect(canPublishQuote('sent')).toBe(true)
    expect(canPublishQuote('accepted')).toBe(true)
    expect(canPublishQuote('draft')).toBe(false)
    expect(canPublishQuote('lost')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/portal.test.ts tests/portal-experience.test.ts tests/portal-interactions.test.ts --maxWorkers=1`
Expected: FAIL — `derivePortalPropertyStatus`/`portalInviteMessage`/`workTimelineIndex` not exported; `propertyStatusPhrase([])` returns `red`; `canPublishQuote('accepted')` is false.

- [ ] **Step 3: Implement**

`src/lib/portal.ts` — append after `derivePropertyStatus`:

```ts
/**
 * Portal-only aggregate: a property with NO register items is 'none'
 * (neutral) rather than red. Office keeps derivePropertyStatus's "untracked
 * = red" for the recall business; the client-facing shopfront must not open
 * on warnings for builders who never keep a register.
 */
export type PortalPropertyStatus = ComplianceStatus | 'none'

export function derivePortalPropertyStatus(
  reviewDues: (string | null)[],
  today: string
): PortalPropertyStatus {
  if (reviewDues.length === 0) return 'none'
  return derivePropertyStatus(reviewDues, today)
}

// ─── Invite copy ─────────────────────────────────────────────────────────────

/** Paste-ready invite text for office (copied from the Issue-link dialog). */
export function portalInviteMessage(
  companyName: string,
  clientName: string,
  url: string
): string {
  return `${companyName} has set up a secure client portal for ${clientName}. Open it here: ${url}. Please keep this link private.`
}
```

`src/lib/portal-experience.ts` — change the import from `@/lib/portal` to also bring in `derivePortalPropertyStatus` and `type PortalPropertyStatus`, then replace `propertyStatusPhrase` so its signature and empty branch read:

```ts
export function propertyStatusPhrase(
  reviewDues: (string | null)[],
  today: string
): { status: PortalPropertyStatus; phrase: string } {
  if (reviewDues.length === 0) {
    return { status: 'none', phrase: 'No compliance register on file' }
  }
  // …the rest of the function is unchanged (it already computes status via
  // derivePropertyStatus for non-empty lists — keep that code as is)…
```

(Keep every other line of the function exactly as it is. If the body assigns `const status = derivePropertyStatus(reviewDues, today)`, leave it: for non-empty input the two helpers agree.)

Add after `workGroupForProject`:

```ts
// ─── Work timeline (client-facing status steps) ──────────────────────────────

export const JOB_TIMELINE = ['quote', 'scheduled', 'in_progress', 'completed'] as const
export const PROJECT_TIMELINE = [
  'active',
  'practical_completion',
  'defects_liability',
  'closed',
] as const

export const WORK_STEP_LABELS: Record<string, string> = {
  quote: 'Quoted',
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  active: 'Active',
  practical_completion: 'Practical completion',
  defects_liability: 'Defects liability',
  closed: 'Closed',
}

/**
 * Step index of a work's status on its client timeline; -1 when the status
 * is not on the timeline (job 'lost' never reaches the portal anyway).
 * invoiced/paid are "Completed" to the client — money stages are internal.
 */
export function workTimelineIndex(kind: 'job' | 'project', status: string): number {
  if (kind === 'job') {
    if (status === 'invoiced' || status === 'paid') return JOB_TIMELINE.length - 1
    return (JOB_TIMELINE as readonly string[]).indexOf(status)
  }
  return (PROJECT_TIMELINE as readonly string[]).indexOf(status)
}
```

`src/lib/portal-interactions.ts` — replace `canPublishQuote`:

```ts
/** Sent quotes go on the portal to be signed; accepted ones stay as records. */
export function canPublishQuote(status: string): boolean {
  return status === APPROVAL_SIGNABLE_STATUS.quote || status === 'accepted'
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/portal.test.ts tests/portal-experience.test.ts tests/portal-interactions.test.ts --maxWorkers=1 && npx tsc --noEmit`
Expected: all PASS. tsc may report the portal pages passing `'none'` into `StatusRing`/`PortalLight` — that is fixed in Task 3; if so, proceed and re-run tsc after Task 3.

- [ ] **Step 5: Commit**

```bash
git add src/lib/portal.ts src/lib/portal-experience.ts src/lib/portal-interactions.ts tests/portal.test.ts tests/portal-experience.test.ts tests/portal-interactions.test.ts
git commit -m "feat: portal property none-state, work timeline steps, invite copy, accepted quotes publishable"
```

---

### Task 2: Migration 0062 — share flags, quote backfill, RPCs

**Files:**
- Create: `supabase/migrations/0062_portal_works_first.sql`

**Interfaces:**
- Produces: `jobs.client_shared`, `projects.client_shared`; RPCs `portal_works(p_token)`, `portal_work_detail(p_token, p_kind, p_id)`; replaced `portal_approvals`, `portal_approval_file`, `portal_site_detail`, `portal_file_path`. Payload shapes are the TypeScript interfaces in Task 3.

- [ ] **Step 1: Write the migration**

```sql
-- 0062: client portal works-first upgrade.
--   * jobs/projects.client_shared — the per-work "Share with client" switch
--     (office action flips the work's attachments' client_visible with it).
--   * quotes backfill: sent/accepted quotes are on the portal by default
--     (setQuoteStatus now publishes on send).
--   * portal_approvals: office-decided items (no portal_acceptances row)
--     appear as decided with source='office'.
--   * portal_approval_file: decided items keep their PDF.
--   * portal_site_detail / portal_file_path: project DIARY photos ride the
--     project's visibility; siteless works can download their files.
--   * portal_works / portal_work_detail: the Works list and work page.

alter table jobs     add column client_shared boolean not null default false;
alter table projects add column client_shared boolean not null default false;

update quotes set portal_published = true
 where status in ('sent','accepted') and not portal_published;

------------------------------------------------------------------------------
-- portal_approvals — 0029 definition + office-decided items
------------------------------------------------------------------------------
create or replace function portal_approvals(p_token text, p_site uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v_pending jsonb;
  v_decided jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  with quote_items as (
    select 'quote' as kind, q.id, q.number, q.title,
           s.name as context, q.site_id,
           (select round(coalesce(sum(round(ql.qty * ql.unit_sell, 2)), 0)
                   * (1 + q.gst_rate / 100), 2)
              from quote_lines ql where ql.quote_id = q.id) as amount,
           true as gst_inclusive,
           to_char(coalesce(q.sent_at, q.created_at) at time zone 'Australia/Brisbane',
                   'YYYY-MM-DD') as item_date,
           q.status, 'sent' as signable_status,
           q.decided_at
    from quotes q
    left join sites s on s.id = q.site_id
    where q.client_id = l.client_id
      and q.portal_published
      and (p_site is null or q.site_id = p_site)
  ),
  variation_items as (
    select 'variation' as kind, v.id,
           'VO-' || v.number::text as number, v.title,
           p.number || ' — ' || p.name as context, p.site_id,
           v.sell_amount as amount,
           false as gst_inclusive,
           to_char(coalesce(v.submitted_at, v.created_at) at time zone 'Australia/Brisbane',
                   'YYYY-MM-DD') as item_date,
           v.status, 'submitted' as signable_status,
           v.decided_at
    from variations v
    join projects p on p.id = v.project_id
    where p.client_id = l.client_id
      and v.portal_published
      and (p_site is null or p.site_id = p_site)
  ),
  items as (
    select * from quote_items union all select * from variation_items
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object(
        'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
        'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
        'gst_inclusive', i.gst_inclusive, 'date', i.item_date)
        order by i.item_date desc, i.number)
      from items i
      where i.status = i.signable_status
        and not exists (select 1 from portal_acceptances a
                         where a.kind = i.kind and a.target_id = i.id)
    ), '[]'::jsonb),
    coalesce((select jsonb_agg(d order by d->>'signed_on' desc nulls last, d->>'number')
      from (
        -- Signed through the portal
        select jsonb_build_object(
          'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
          'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
          'gst_inclusive', i.gst_inclusive, 'date', i.item_date,
          'action', a.action, 'signer_name', a.signer_name,
          'signed_on', to_char(a.signed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'source', 'portal') as d
        from items i
        join lateral (
          select * from portal_acceptances a
          where a.kind = i.kind and a.target_id = i.id
          order by a.action = 'accepted' desc, a.signed_at desc
          limit 1
        ) a on true
        union all
        -- Decided in the office (accepted/lost, approved/rejected) with no
        -- portal signature — still the client's record.
        select jsonb_build_object(
          'kind', i.kind, 'id', i.id, 'number', i.number, 'title', i.title,
          'context', i.context, 'site_id', i.site_id, 'amount', i.amount,
          'gst_inclusive', i.gst_inclusive, 'date', i.item_date,
          'action', case when i.status in ('accepted','approved') then 'accepted' else 'declined' end,
          'signer_name', null,
          'signed_on', to_char(i.decided_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
          'source', 'office')
        from items i
        where i.status in ('accepted','lost','approved','rejected')
          and not exists (select 1 from portal_acceptances a
                           where a.kind = i.kind and a.target_id = i.id)
      ) x
    ), '[]'::jsonb)
  into v_pending, v_decided;

  return jsonb_build_object('pending', v_pending, 'decided', v_decided);
end $$;

------------------------------------------------------------------------------
-- portal_approval_file — decided items keep their PDF
------------------------------------------------------------------------------
create or replace function portal_approval_file(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_number text;
  v_site uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind = 'quote' then
    select q.number, q.site_id into v_number, v_site
      from quotes q
     where q.id = p_id and q.client_id = l.client_id
       and q.portal_published and q.status in ('sent','accepted','lost');
  elsif p_kind = 'variation' then
    select 'VO-' || v.number::text, p.site_id into v_number, v_site
      from variations v
      join projects p on p.id = v.project_id
     where v.id = p_id and p.client_id = l.client_id
       and v.portal_published and v.status in ('submitted','approved','rejected');
  end if;

  if v_number is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:approval:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('number', v_number);
end $$;

------------------------------------------------------------------------------
-- portal_site_detail — 0053 definition + diary photos on projects
------------------------------------------------------------------------------
create or replace function portal_site_detail(p_token text, p_site uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  s sites%rowtype;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  select * into s from sites
   where id = p_site and client_id = l.client_id;
  if not found then return null; end if;

  return jsonb_build_object(
    'site', jsonb_build_object(
      'id', s.id, 'name', s.name, 'address', s.address,
      'suburb', s.suburb, 'state', s.state, 'postcode', s.postcode),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'kind', i.kind, 'title', i.title,
        'issue_date', i.issue_date, 'review_due', i.review_due,
        'notes', i.notes,
        'filename', coalesce(i.evidence_filename, d.filename),
        'has_file', (i.evidence_path is not null or d.file_path is not null))
        order by i.kind, i.issue_date desc)
      from property_compliance_items i
      left join documents d on d.id = i.document_id
      where i.site_id = s.id and i.status = 'active'
    ), '[]'::jsonb),
    'maintenance', case when l.scope = 'full' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'kind', m.kind, 'title', m.title,
        'description', m.description,
        'done_at', m.done_at,
        'status', m.status,
        'follow_up', m.follow_up,
        'follow_up_due', m.follow_up_due,
        'job_number', j.number, 'project_number', p.number,
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption)
            order by a.created_at)
          from attachments a
          where a.parent_type = 'maintenance' and a.parent_id = m.id
        ), '[]'::jsonb))
        order by m.done_at desc, m.created_at desc)
      from maintenance_entries m
      left join jobs j on j.id = m.job_id
      left join projects p on p.id = m.project_id
      where m.site_id = s.id and m.client_visible
    ), '[]'::jsonb) else '[]'::jsonb end,
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', j.id, 'number', j.number, 'title', j.title, 'status', j.status,
        'scheduled_start', j.scheduled_start, 'scheduled_end', j.scheduled_end,
        'completed_on', to_char(j.completed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption,
            'size', a.size,
            'created_at', a.created_at,
            'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
            order by a.created_at desc)
          from attachments a
          where a.parent_type = 'job' and a.parent_id = j.id and a.client_visible
        ), '[]'::jsonb))
        order by j.created_at desc)
      from jobs j
      where j.site_id = s.id and j.status not in ('quote','lost') and not j.archived
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'number', p.number, 'name', p.name, 'status', p.status,
        'start_date', p.start_date,
        'practical_completion_date', p.practical_completion_date,
        'progress_pct', (
          select round(
            sum(t.progress_pct * (t.end_date - t.start_date + 1))
            / nullif(sum(t.end_date - t.start_date + 1), 0))
          from programme_tasks t
          where t.project_id = p.id
        ),
        'attachments', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', a.id, 'filename', a.filename, 'kind', a.kind,
            'content_type', a.content_type, 'caption', a.caption,
            'size', a.size,
            'created_at', a.created_at,
            'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
            order by a.created_at desc)
          from attachments a
          where a.client_visible
            and ((a.parent_type = 'project' and a.parent_id = p.id)
              or (a.parent_type = 'diary' and a.parent_id in
                    (select d.id from diaries d where d.project_id = p.id)))
        ), '[]'::jsonb))
        order by p.created_at desc)
      from projects p
      where p.site_id = s.id and not p.archived
    ), '[]'::jsonb));
end $$;

------------------------------------------------------------------------------
-- portal_file_path — 0026 definition + diary parents + siteless works.
-- Entitlement is the WORK's client, not the site (works may have no site).
------------------------------------------------------------------------------
create or replace function portal_file_path(p_token text, p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_path text;
  v_filename text;
  v_site uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if p_kind = 'item' then
    select coalesce(i.evidence_path, d.file_path),
           coalesce(i.evidence_filename, d.filename, i.title),
           i.site_id
      into v_path, v_filename, v_site
      from property_compliance_items i
      join sites s on s.id = i.site_id and s.client_id = l.client_id
      left join documents d on d.id = i.document_id
     where i.id = p_id and i.status = 'active';
  elsif p_kind = 'attachment' then
    select a.path, a.filename,
           coalesce(j.site_id, p.site_id, dp.site_id)
      into v_path, v_filename, v_site
      from attachments a
      left join jobs j on a.parent_type = 'job' and j.id = a.parent_id
      left join projects p on a.parent_type = 'project' and p.id = a.parent_id
      left join diaries d on a.parent_type = 'diary' and d.id = a.parent_id
      left join projects dp on dp.id = d.project_id
     where a.id = p_id and a.client_visible
       and coalesce(j.client_id, p.client_id, dp.client_id) = l.client_id;
  end if;

  if v_path is null then return null; end if;

  insert into portal_views (client_link_id, site_id, path)
  values (l.id, v_site, left('download:' || p_kind || ':' || p_id::text, 300));

  return jsonb_build_object('path', v_path, 'filename', v_filename);
end $$;

------------------------------------------------------------------------------
-- portal_works — every job/project for the client (full-scope links only),
-- with counts of what is client-visible. NO money.
------------------------------------------------------------------------------
create function portal_works(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  return coalesce((
    select jsonb_agg(w order by w->>'sort_date' desc nulls last, w->>'number')
    from (
      select jsonb_build_object(
        'kind', 'job', 'id', j.id, 'number', j.number, 'title', j.title,
        'status', j.status,
        'site_id', j.site_id, 'site_name', s.name,
        'from', j.scheduled_start, 'to', j.scheduled_end,
        'completed_on', to_char(j.completed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
        'progress_pct', null,
        'photo_count', (select count(*) from attachments a
                         where a.parent_type = 'job' and a.parent_id = j.id
                           and a.client_visible and a.kind = 'photo'),
        'doc_count', (select count(*) from attachments a
                       where a.parent_type = 'job' and a.parent_id = j.id
                         and a.client_visible and a.kind in ('document','pdf')
                         and coalesce(a.caption, '') <> 'Handover pack'),
        'has_handover', exists (select 1 from attachments a
                                 where a.parent_type = 'job' and a.parent_id = j.id
                                   and a.client_visible and a.kind <> 'photo'
                                   and a.caption = 'Handover pack'),
        'quote_id', q.id, 'quote_number', q.number,
        'sort_date', coalesce(j.scheduled_start::text,
                              to_char(j.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
      ) as w
      from jobs j
      left join sites s on s.id = j.site_id
      left join quotes q on q.id = j.quote_id and q.portal_published
      where j.client_id = l.client_id
        and j.status not in ('quote','lost') and not j.archived

      union all

      select jsonb_build_object(
        'kind', 'project', 'id', p.id, 'number', p.number, 'title', p.name,
        'status', p.status,
        'site_id', p.site_id, 'site_name', s.name,
        'from', p.start_date, 'to', p.practical_completion_date,
        'completed_on', p.practical_completion_date,
        'progress_pct', (
          select round(
            sum(t.progress_pct * (t.end_date - t.start_date + 1))
            / nullif(sum(t.end_date - t.start_date + 1), 0))
          from programme_tasks t where t.project_id = p.id),
        'photo_count', (select count(*) from attachments a
                         where a.client_visible and a.kind = 'photo'
                           and ((a.parent_type = 'project' and a.parent_id = p.id)
                             or (a.parent_type = 'diary' and a.parent_id in
                                   (select d.id from diaries d where d.project_id = p.id)))),
        'doc_count', (select count(*) from attachments a
                       where a.parent_type = 'project' and a.parent_id = p.id
                         and a.client_visible and a.kind in ('document','pdf')
                         and coalesce(a.caption, '') <> 'Handover pack'),
        'has_handover', exists (select 1 from attachments a
                                 where a.parent_type = 'project' and a.parent_id = p.id
                                   and a.client_visible and a.kind <> 'photo'
                                   and a.caption = 'Handover pack'),
        'quote_id', q.id, 'quote_number', q.number,
        'sort_date', coalesce(p.start_date::text,
                              to_char(p.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
      ) as w
      from projects p
      left join sites s on s.id = p.site_id
      left join quotes q on q.id = p.quote_id and q.portal_published
      where p.client_id = l.client_id and not p.archived
    ) x
  ), '[]'::jsonb);
end $$;

------------------------------------------------------------------------------
-- portal_work_detail — one work page. Null unless the work is the client's
-- (and the link is full-scope).
------------------------------------------------------------------------------
create function portal_work_detail(p_token text, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
  v jsonb;
begin
  l := portal_live_link(p_token);
  if l.id is null or coalesce(l.scope, 'full') <> 'full' then return null; end if;

  if p_kind = 'job' then
    select jsonb_build_object(
      'kind', 'job', 'id', j.id, 'number', j.number, 'title', j.title,
      'status', j.status, 'description', j.description,
      'site_id', j.site_id, 'site_name', s.name,
      'site_address', nullif(concat_ws(', ', s.address, s.suburb, s.state, s.postcode), ''),
      'from', j.scheduled_start, 'to', j.scheduled_end,
      'completed_on', to_char(j.completed_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'),
      'progress_pct', null,
      'quote', case when q.id is null then null else jsonb_build_object(
        'id', q.id, 'number', q.number, 'status', q.status,
        'decided', (select a.action from portal_acceptances a
                     where a.kind = 'quote' and a.target_id = q.id
                     order by a.action = 'accepted' desc, a.signed_at desc limit 1)) end,
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'filename', a.filename, 'kind', a.kind,
          'content_type', a.content_type, 'caption', a.caption,
          'size', a.size, 'created_at', a.created_at,
          'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
          order by a.created_at desc)
        from attachments a
        where a.parent_type = 'job' and a.parent_id = j.id and a.client_visible
      ), '[]'::jsonb))
    into v
    from jobs j
    left join sites s on s.id = j.site_id
    left join quotes q on q.id = j.quote_id and q.portal_published
    where j.id = p_id and j.client_id = l.client_id
      and j.status not in ('quote','lost') and not j.archived;
  elsif p_kind = 'project' then
    select jsonb_build_object(
      'kind', 'project', 'id', p.id, 'number', p.number, 'title', p.name,
      'status', p.status, 'description', p.description,
      'site_id', p.site_id, 'site_name', s.name,
      'site_address', nullif(concat_ws(', ', s.address, s.suburb, s.state, s.postcode), ''),
      'from', p.start_date, 'to', p.practical_completion_date,
      'completed_on', p.practical_completion_date,
      'progress_pct', (
        select round(
          sum(t.progress_pct * (t.end_date - t.start_date + 1))
          / nullif(sum(t.end_date - t.start_date + 1), 0))
        from programme_tasks t where t.project_id = p.id),
      'quote', case when q.id is null then null else jsonb_build_object(
        'id', q.id, 'number', q.number, 'status', q.status,
        'decided', (select a.action from portal_acceptances a
                     where a.kind = 'quote' and a.target_id = q.id
                     order by a.action = 'accepted' desc, a.signed_at desc limit 1)) end,
      'attachments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', a.id, 'filename', a.filename, 'kind', a.kind,
          'content_type', a.content_type, 'caption', a.caption,
          'size', a.size, 'created_at', a.created_at,
          'created_on', to_char(a.created_at at time zone 'Australia/Brisbane', 'YYYY-MM-DD'))
          order by a.created_at desc)
        from attachments a
        where a.client_visible
          and ((a.parent_type = 'project' and a.parent_id = p.id)
            or (a.parent_type = 'diary' and a.parent_id in
                  (select d.id from diaries d where d.project_id = p.id)))
      ), '[]'::jsonb))
    into v
    from projects p
    left join sites s on s.id = p.site_id
    left join quotes q on q.id = p.quote_id and q.portal_published
    where p.id = p_id and p.client_id = l.client_id and not p.archived;
  end if;

  return v;
end $$;

grant execute on function portal_works(text) to anon, authenticated;
grant execute on function portal_work_detail(text, text, uuid) to anon, authenticated;
```

- [ ] **Step 2: Sanity-check the SQL text**

Run: `grep -c "create or replace function\|create function" supabase/migrations/0062_portal_works_first.sql`
Expected: `6` (approvals, approval_file, site_detail, file_path, works, work_detail).

- [ ] **Step 3: Commit (NOT applied yet)**

```bash
git add supabase/migrations/0062_portal_works_first.sql
git commit -m "feat: portal works-first schema — client_shared flags, quote backfill, works RPCs, office-decided approvals (0062)"
```

- [ ] **Step 4: Hand the owner the paste**

Tell the owner: paste the file's contents into the Supabase SQL editor for project `zspauxavbhtutanhekuu`, followed by
`insert into supabase_migrations.schema_migrations (version, name) values ('20260904090000', '0062_portal_works_first');`
Later tasks' live RPC proofs need it applied; page work (Tasks 3–7) can proceed against the code in the meantime.

---

### Task 3: Portal UI primitives — nav, none-state, WorkTimeline, shared work-ui, payload types

**Files:**
- Modify: `src/app/portal/[token]/portal-ui.tsx`
- Create: `src/app/portal/[token]/work-ui.tsx`
- Modify (only the `active=` prop): `src/app/portal/[token]/request/page.tsx`, `approvals/page.tsx`, `approvals/[kind]/[id]/page.tsx`, `sites/[siteId]/page.tsx`, `page.tsx`

**Interfaces:**
- Produces (portal-ui.tsx): `PortalSiteRow`; `PortalShell` prop `active: 'overview' | 'works' | 'quotes' | 'properties' | 'calendar'`; `StatusRing`/`PortalLight` accept `PortalPropertyStatus`; `WorkTimeline({ kind, status })`; types `PortalWorkSummary`, `PortalWorkDetail`, `PortalAttachment`, `PortalFileRef`; `PortalDecidedItem.source?: 'portal' | 'office'`, `signer_name: string | null`.
- Produces (work-ui.tsx): `PhotoGallery({ token, photos, limit? })`, `DocRows({ token, docs })`, `isPhoto(a)`, `WorkCard({ token, work })`.

- [ ] **Step 1: portal-ui.tsx — types**

Replace the `PortalDecidedItem` interface with:

```ts
export interface PortalDecidedItem extends PortalApprovalItem {
  action: 'accepted' | 'declined'
  /** null when decided in the office rather than signed on the portal. */
  signer_name: string | null
  signed_on: string | null
  /** Present once migration 0062 runs. */
  source?: 'portal' | 'office'
}
```

Add after `PortalBillingRow`:

```ts
// ─── Works payloads (portal_works / portal_work_detail, migration 0062) ──────

export interface PortalAttachment {
  id: string
  filename: string
  kind: string
  content_type: string | null
  caption: string | null
  size: number | null
  created_at: string
  created_on: string | null
}

/** Minimal shape the thumbnail row + doc links need. */
export interface PortalFileRef {
  id: string
  filename: string
  content_type: string | null
  caption: string | null
}

export interface PortalWorkSummary {
  kind: 'job' | 'project'
  id: string
  number: string
  title: string
  status: string
  site_id: string | null
  site_name: string | null
  from: string | null
  to: string | null
  completed_on: string | null
  progress_pct: number | null
  photo_count: number
  doc_count: number
  has_handover: boolean
  quote_id: string | null
  quote_number: string | null
}

export interface PortalSiteRow {
  id: string
  name: string
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
  review_dues: (string | null)[]
  open_works: number
}

export interface PortalWorkDetail {
  kind: 'job' | 'project'
  id: string
  number: string
  title: string
  status: string
  description: string | null
  site_id: string | null
  site_name: string | null
  site_address: string | null
  from: string | null
  to: string | null
  completed_on: string | null
  progress_pct: number | null
  quote: {
    id: string
    number: string
    status: string
    decided: 'accepted' | 'declined' | null
  } | null
  attachments: PortalAttachment[]
}
```

- [ ] **Step 2: portal-ui.tsx — nav**

Change the import line `import { complianceTitle, type ComplianceStatus } from '@/lib/compliance'` to also import `type PortalPropertyStatus` from `'@/lib/portal'`, and import `workTimelineIndex, JOB_TIMELINE, PROJECT_TIMELINE, WORK_STEP_LABELS` from `'@/lib/portal-experience'`. Add `FileSignatureIcon, HardHatIcon, LayoutDashboardIcon, BuildingIcon` to the lucide import.

Replace the `PortalShell` `active` prop type and the `<nav>` block:

```tsx
  active: 'overview' | 'works' | 'quotes' | 'properties' | 'calendar'
```

```tsx
      {/* Nav — register-scope links are a single-property register view */}
      {!isRegisterScope(branding) && (
        <nav className="border-b bg-white">
          <div className="mx-auto flex w-full max-w-4xl gap-1 overflow-x-auto px-4 [scrollbar-width:none]">
            <PortalNavLink
              href={`/portal/${token}`}
              label="Overview"
              icon={<LayoutDashboardIcon className="size-4" />}
              active={active === 'overview'}
            />
            <PortalNavLink
              href={`/portal/${token}/works`}
              label="Works"
              icon={<HardHatIcon className="size-4" />}
              active={active === 'works'}
            />
            <PortalNavLink
              href={`/portal/${token}/approvals`}
              label="Quotes"
              icon={<FileSignatureIcon className="size-4" />}
              active={active === 'quotes'}
            />
            <PortalNavLink
              href={`/portal/${token}/properties`}
              label="Properties"
              icon={<Building2Icon className="size-4" />}
              active={active === 'properties'}
            />
            <PortalNavLink
              href={`/portal/${token}/calendar`}
              label="Calendar"
              icon={<CalendarDaysIcon className="size-4" />}
              active={active === 'calendar'}
            />
          </div>
        </nav>
      )}
```

In `PortalNavLink` add `shrink-0 whitespace-nowrap` to the link className so five items scroll instead of wrapping.

- [ ] **Step 3: portal-ui.tsx — none-state lights**

Replace `STATUS_DOT`, `STATUS_LABELS`, `PortalLight` and `StatusRing`:

```tsx
export const STATUS_DOT: Record<PortalPropertyStatus, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
  none: 'bg-slate-300',
}

const STATUS_LABELS: Record<PortalPropertyStatus, string> = {
  green: 'Current',
  amber: 'Review due soon',
  red: 'Attention required',
  none: 'No compliance register on file',
}

function statusTitle(status: PortalPropertyStatus): string {
  return status === 'none' ? STATUS_LABELS.none : complianceTitle(status)
}

/** Traffic-light dot + label, sized for compliance rows. */
export function PortalLight({
  status,
  label,
}: {
  status: PortalPropertyStatus
  label?: string
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600"
      title={statusTitle(status)}
    >
      <span
        className={`inline-block size-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`}
      />
      {label ?? STATUS_LABELS[status]}
    </span>
  )
}

/**
 * At-a-glance compliance ring for property cards: a circled status icon in
 * the property's aggregate colour. 'none' = no register kept (neutral).
 */
export function StatusRing({ status }: { status: PortalPropertyStatus }) {
  const styles: Record<PortalPropertyStatus, string> = {
    green: 'bg-green-50 text-green-600 ring-green-500/40',
    amber: 'bg-amber-50 text-amber-600 ring-amber-500/50',
    red: 'bg-red-50 text-red-600 ring-red-500/40',
    none: 'bg-slate-50 text-slate-400 ring-slate-300/60',
  }
  const Icon =
    status === 'green'
      ? CheckIcon
      : status === 'amber'
        ? ClockIcon
        : status === 'red'
          ? TriangleAlertIcon
          : BuildingIcon
  return (
    <span
      className={`flex size-11 shrink-0 items-center justify-center rounded-full ring-2 ${styles[status]}`}
      title={statusTitle(status)}
    >
      <Icon className="size-5" strokeWidth={2.5} />
    </span>
  )
}
```

`ComplianceStatus` may now be unused in this file — keep the import only if something else still uses it (tsc/lint will tell you).

- [ ] **Step 4: portal-ui.tsx — WorkTimeline**

Add after `ProgressBar`:

```tsx
/**
 * Where a work sits on its client-facing timeline (jobs: Quoted → Scheduled →
 * In progress → Completed; projects: Active → Practical completion → Defects
 * liability → Closed). Same visual language as RequestTimeline.
 */
export function WorkTimeline({
  kind,
  status,
}: {
  kind: 'job' | 'project'
  status: string
}) {
  const steps = kind === 'job' ? JOB_TIMELINE : PROJECT_TIMELINE
  const index = workTimelineIndex(kind, status)
  if (index < 0) return null
  return (
    <ol className="flex items-center" aria-label="Work progress">
      {steps.map((step, i) => {
        const reached = i <= index
        const isCurrent = i === index
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center last:flex-none">
            <span className="flex flex-col items-center gap-1">
              <span
                className={`flex size-4 items-center justify-center rounded-full ring-2 ${
                  reached ? 'bg-blue-600 ring-blue-600' : 'bg-white ring-slate-300'
                }`}
              >
                {reached && <CheckIcon className="size-2.5 text-white" strokeWidth={3.5} />}
              </span>
              <span
                className={`whitespace-nowrap text-[10px] leading-none ${
                  isCurrent ? 'font-semibold text-blue-700' : 'text-slate-400'
                }`}
              >
                {WORK_STEP_LABELS[step]}
              </span>
            </span>
            <span
              className={`mx-1 mb-4 h-0.5 flex-1 rounded ${
                i < index ? 'bg-blue-600' : 'bg-slate-200'
              } ${i === steps.length - 1 ? 'hidden' : ''}`}
            />
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 5: Create work-ui.tsx**

Move `PhotoGallery`, `DocRows` and `isPhoto` out of `sites/[siteId]/page.tsx` into this file (exported), add `limit` and `WorkCard`:

```tsx
import Link from 'next/link'
import {
  CalendarIcon,
  ChevronRightIcon,
  DownloadIcon,
  FileCheckIcon,
  FileTextIcon,
  ImageIcon,
  MapPinIcon,
} from 'lucide-react'
import { fmtDate } from '@/lib/format'
import {
  ProgressBar,
  WorkStatusBadge,
  type PortalFileRef,
  type PortalWorkSummary,
} from './portal-ui'

/** Shared work building blocks: photo grid, document rows, list cards. */

export const isPhoto = (a: PortalFileRef) => a.content_type?.startsWith('image/')

export function PhotoGallery({
  token,
  photos,
  limit,
}: {
  token: string
  photos: PortalFileRef[]
  /** Show only the first N (the site page previews; the work page shows all). */
  limit?: number
}) {
  if (photos.length === 0) return null
  const shown = limit ? photos.slice(0, limit) : photos
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {shown.map((p) => (
        <a
          key={p.id}
          href={`/portal/${token}/file/attachment/${p.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block aspect-square overflow-hidden rounded-xl border bg-slate-100"
          aria-label={`View ${p.filename}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/portal/${token}/file/attachment/${p.id}`}
            alt={p.caption ?? p.filename}
            className="h-full w-full object-cover transition-transform hover:scale-105"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  )
}

export function DocRows({
  token,
  docs,
}: {
  token: string
  docs: PortalFileRef[]
}) {
  if (docs.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {docs.map((d) => (
        <a
          key={d.id}
          href={`/portal/${token}/file/attachment/${d.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors hover:bg-slate-50"
        >
          <FileTextIcon className="size-4 shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 truncate font-medium text-slate-700">
            {d.filename}
          </span>
          <DownloadIcon className="size-3.5 shrink-0 text-slate-300" />
        </a>
      ))}
    </div>
  )
}

/** One work in a list (Overview "Current works", Works page). */
export function WorkCard({
  token,
  work,
}: {
  token: string
  work: PortalWorkSummary
}) {
  const dates = [
    work.from ? `From ${fmtDate(work.from)}` : null,
    work.to ? `to ${fmtDate(work.to)}` : null,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <Link
      href={`/portal/${token}/works/${work.kind}/${work.id}`}
      className="block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            {work.number}
          </p>
          <p className="truncate text-[15px] font-semibold text-slate-900">{work.title}</p>
          {work.site_name && (
            <p className="flex items-center gap-1 truncate text-xs text-slate-500">
              <MapPinIcon className="size-3 shrink-0" />
              <span className="truncate">{work.site_name}</span>
            </p>
          )}
        </div>
        <WorkStatusBadge status={work.status} />
      </div>
      {dates && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarIcon className="size-3.5 text-slate-400" />
          {dates}
        </p>
      )}
      {work.progress_pct !== null && (
        <div className="mt-2">
          <ProgressBar pct={work.progress_pct} />
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
        {work.photo_count > 0 && (
          <span className="flex items-center gap-1">
            <ImageIcon className="size-3.5 text-slate-400" />
            {work.photo_count} photo{work.photo_count === 1 ? '' : 's'}
          </span>
        )}
        {work.doc_count > 0 && (
          <span className="flex items-center gap-1">
            <FileTextIcon className="size-3.5 text-slate-400" />
            {work.doc_count} document{work.doc_count === 1 ? '' : 's'}
          </span>
        )}
        {work.has_handover && (
          <span className="flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 font-medium text-green-700">
            <FileCheckIcon className="size-3.5" />
            Close-out pack
          </span>
        )}
        <ChevronRightIcon className="ml-auto size-4 text-slate-300" />
      </div>
    </Link>
  )
}
```

- [ ] **Step 6: Update the `active` props**

- `request/page.tsx`: `active="overview"`
- `approvals/page.tsx` and `approvals/[kind]/[id]/page.tsx`: `active="quotes"`
- `sites/[siteId]/page.tsx`: `active="properties"` (unchanged value; still valid)
- `page.tsx`: `active="overview"` (this page is rewritten in Task 4; set it now so tsc passes)

In `sites/[siteId]/page.tsx` delete the local `PhotoGallery`, `DocRows`, `isPhoto`, `PortalAttachment` and `PortalFileRef` definitions and import them instead:

```ts
import { DocRows, isPhoto, PhotoGallery } from '../../work-ui'
import { type PortalAttachment, type PortalFileRef } from '../../portal-ui'
```

(Add the two types to the existing `'../../portal-ui'` import list rather than a second import statement.)

- [ ] **Step 7: Typecheck + lint + tests**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`
Expected: clean. Remaining tsc errors will be in `page.tsx` / `sites/[siteId]/page.tsx` calling `derivePropertyStatus` into `StatusRing` — `ComplianceStatus` is assignable to `PortalPropertyStatus`, so these compile; Task 4/6 swap them to the portal helper.

- [ ] **Step 8: Commit**

```bash
git add src/app/portal
git commit -m "feat: portal shell nav (overview/works/quotes/properties/calendar), neutral no-register state, WorkTimeline, shared work-ui"
```

---

### Task 4: Overview (works-first) and Properties pages

**Files:**
- Create: `src/app/portal/[token]/properties/page.tsx`
- Rewrite: `src/app/portal/[token]/page.tsx`

**Interfaces:**
- Consumes: `portal_works` RPC (Task 2) → `PortalWorkSummary[]`; `WorkCard` (Task 3); `derivePortalPropertyStatus`, `propertyStatusPhrase` (Task 1).

- [ ] **Step 1: Properties page**

`src/app/portal/[token]/properties/page.tsx` — today's property list, moved verbatim from the old landing page with the portal status helper:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRightIcon, MapPinIcon, PlusIcon } from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { derivePortalPropertyStatus } from '@/lib/portal'
import { propertyStatusPhrase } from '@/lib/portal-experience'
import {
  EmptyState,
  isRegisterScope,
  LinkInactivePage,
  PortalLight,
  PortalShell,
  StatusRing,
  type PortalBranding,
  type PortalSiteRow,
} from '../portal-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/** Every property ECR serves for this client, with its compliance ring. */
export default async function PortalPropertiesPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: sitesData }] = await Promise.all([
    supabase.rpc('portal_sites', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal/properties',
    }),
  ])
  const sites = ((sitesData ?? []) as PortalSiteRow[]) ?? []
  const today = todayAU()

  return (
    <PortalShell branding={branding} token={token} active="properties">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Your properties</h1>
          <p className="text-sm text-slate-500">
            Every site we look after for {branding.client_name}.
          </p>
        </div>
        <Link
          href={`/portal/${token}/request`}
          className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#162040] px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <PlusIcon className="size-4" />
          Request work
        </Link>
      </div>

      {sites.length === 0 ? (
        <EmptyState>No properties on record yet.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {sites.map((site) => {
            const address = [site.address, site.suburb, site.state, site.postcode]
              .filter(Boolean)
              .join(', ')
            const dues = site.review_dues ?? []
            const status = derivePortalPropertyStatus(dues, today)
            const { phrase } = propertyStatusPhrase(dues, today)
            return (
              <li key={site.id}>
                <Link
                  href={`/portal/${token}/sites/${site.id}`}
                  className="block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
                >
                  <div className="flex items-center gap-3.5">
                    <StatusRing status={status} />
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="truncate text-[15px] font-semibold text-slate-900">
                        {site.name}
                      </p>
                      {address && (
                        <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                          <MapPinIcon className="size-3 shrink-0" />
                          <span className="truncate">{address}</span>
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                        <PortalLight status={status} label={phrase} />
                        <span
                          className={`text-xs ${
                            site.open_works > 0 ? 'font-medium text-blue-700' : 'text-slate-400'
                          }`}
                        >
                          {site.open_works === 0
                            ? 'No open works'
                            : `${site.open_works} open work${site.open_works === 1 ? '' : 's'}`}
                        </span>
                      </div>
                    </div>
                    <ChevronRightIcon className="size-5 shrink-0 text-slate-300" />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </PortalShell>
  )
}
```

- [ ] **Step 2: Overview page**

Rewrite `src/app/portal/[token]/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  Building2Icon,
  ChevronRightIcon,
  CircleCheckIcon,
  ClockIcon,
  FileSignatureIcon,
  FileTextIcon,
  InboxIcon,
  MapPinIcon,
  PlusIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'
import { aud, fmtDate } from '@/lib/format'
import { derivePortalPropertyStatus } from '@/lib/portal'
import {
  propertyStatusPhrase,
  summarisePortfolio,
  workGroupForJob,
  workGroupForProject,
} from '@/lib/portal-experience'
import {
  isRegisterScope,
  LinkInactivePage,
  PortalCard,
  PortalLight,
  PortalShell,
  RequestStatusChip,
  StatusRing,
  type PortalApprovalsPayload,
  type PortalBranding,
  type PortalRequestRow,
  type PortalSiteRow,
  type PortalWorkSummary,
} from './portal-ui'
import { WorkCard } from './work-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/**
 * Overview (works-first): approvals banner, headline cards, current works
 * across every property, pending quotes, a compact property list and open
 * requests. Compliance only takes a card when the client keeps a register.
 * No login — the token is the credential; every load is logged.
 */
export default async function PortalHomePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [
    { data: sitesData },
    { data: approvalsData },
    { data: requestsData },
    { data: worksData },
  ] = await Promise.all([
    supabase.rpc('portal_sites', { p_token: token }),
    supabase.rpc('portal_approvals', { p_token: token }),
    supabase.rpc('portal_my_requests', { p_token: token }),
    supabase.rpc('portal_works', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal',
    }),
  ])
  const sites = ((sitesData ?? []) as PortalSiteRow[]) ?? []
  const approvals = ((approvalsData ?? null) as PortalApprovalsPayload | null) ?? {
    pending: [],
    decided: [],
  }
  const requests = ((requestsData ?? []) as PortalRequestRow[]) ?? []
  const works = ((worksData ?? []) as PortalWorkSummary[]) ?? []

  const openRequests = requests.filter(
    (r) => r.status !== 'completed' && r.status !== 'declined'
  )
  const currentWorks = works.filter((w) =>
    (w.kind === 'job' ? workGroupForJob(w.status) : workGroupForProject(w.status)) === 'live'
  )
  const today = todayAU()
  const summary = summarisePortfolio(sites, today)
  const keepsRegister = sites.some((s) => (s.review_dues ?? []).length > 0)

  return (
    <PortalShell branding={branding} token={token} active="overview">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Welcome, {branding.client_name}
          </h1>
          <p className="text-sm text-slate-500">
            Your quotes, works and property records with {branding.company_name} —{' '}
            all in one place.
          </p>
        </div>
        {keepsRegister && (
          <a
            href={`/portal/${token}/report-pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-11 items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
          >
            <FileTextIcon className="size-4" />
            Compliance report (PDF)
          </a>
        )}
      </div>

      {/* Awaiting approvals */}
      {approvals.pending.length > 0 && (
        <Link
          href={`/portal/${token}/approvals`}
          className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition-colors hover:bg-amber-100/70"
        >
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-amber-600 ring-2 ring-amber-500/40">
            <FileSignatureIcon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-amber-900">
              {approvals.pending.length === 1
                ? '1 quote awaiting your approval'
                : `${approvals.pending.length} items awaiting your approval`}
            </span>
            <span className="block text-xs text-amber-700">
              Review and sign online — it takes less than a minute.
            </span>
          </span>
          <ChevronRightIcon className="size-5 shrink-0 text-amber-400" />
        </Link>
      )}

      {/* Headline summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          icon={<WrenchIcon className="size-4" />}
          iconClass="bg-blue-50 text-blue-600"
          value={String(currentWorks.length)}
          label={currentWorks.length === 1 ? 'Active work' : 'Active works'}
          valueClass={currentWorks.length > 0 ? 'text-blue-700' : undefined}
        />
        <SummaryCard
          icon={<FileSignatureIcon className="size-4" />}
          iconClass={
            approvals.pending.length > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-600'
          }
          value={String(approvals.pending.length)}
          label="Awaiting approval"
          valueClass={approvals.pending.length > 0 ? 'text-amber-600' : undefined}
        />
        <SummaryCard
          icon={<InboxIcon className="size-4" />}
          iconClass="bg-slate-100 text-slate-600"
          value={String(openRequests.length)}
          label={openRequests.length === 1 ? 'Open request' : 'Open requests'}
        />
        {!keepsRegister ? (
          <SummaryCard
            icon={<Building2Icon className="size-4" />}
            iconClass="bg-slate-100 text-slate-600"
            value={String(summary.properties)}
            label={summary.properties === 1 ? 'Property' : 'Properties'}
          />
        ) : summary.overdue > 0 ? (
          <SummaryCard
            icon={<TriangleAlertIcon className="size-4" />}
            iconClass="bg-red-50 text-red-600"
            value={String(summary.overdue)}
            label={summary.overdue === 1 ? 'Item needs attention' : 'Items need attention'}
            valueClass="text-red-600"
          />
        ) : summary.dueSoon30 > 0 ? (
          <SummaryCard
            icon={<ClockIcon className="size-4" />}
            iconClass="bg-amber-50 text-amber-600"
            value={`${summary.dueSoon30} due soon`}
            label="Compliance"
            valueClass="text-amber-600"
          />
        ) : (
          <SummaryCard
            icon={<CircleCheckIcon className="size-4" />}
            iconClass="bg-green-50 text-green-600"
            value="All current"
            label="Compliance"
            valueClass="text-green-700"
          />
        )}
      </div>

      {/* Current works */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Current works
          </h2>
          {works.length > currentWorks.length && (
            <Link
              href={`/portal/${token}/works`}
              className="flex min-h-6 items-center gap-1 text-sm font-medium text-[#162040] hover:underline"
            >
              All works <ChevronRightIcon className="size-4" />
            </Link>
          )}
        </div>
        {currentWorks.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
            No works under way right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {currentWorks.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <WorkCard token={token} work={w} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pending quotes */}
      {approvals.pending.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Your quotes
            </h2>
            <Link
              href={`/portal/${token}/approvals`}
              className="flex min-h-6 items-center gap-1 text-sm font-medium text-[#162040] hover:underline"
            >
              All quotes <ChevronRightIcon className="size-4" />
            </Link>
          </div>
          <PortalCard className="divide-y">
            {approvals.pending.slice(0, 3).map((item) => (
              <Link
                key={`${item.kind}-${item.id}`}
                href={`/portal/${token}/approvals/${item.kind}/${item.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {item.number} — {item.title}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {item.context ?? (item.kind === 'quote' ? 'Quotation' : 'Variation')}
                    {item.date ? ` · ${fmtDate(item.date)}` : ''}
                  </p>
                </div>
                {item.amount != null && (
                  <span className="text-sm font-semibold tabular-nums text-slate-900">
                    {aud(item.amount)}
                  </span>
                )}
                <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
              </Link>
            ))}
          </PortalCard>
        </div>
      )}

      {/* Properties */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your properties
          </h2>
          <Link
            href={`/portal/${token}/request`}
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-[#162040] px-3.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <PlusIcon className="size-4" />
            Request work
          </Link>
        </div>
        {sites.length === 0 ? (
          <p className="rounded-2xl border border-dashed bg-white px-4 py-10 text-center text-sm text-slate-500">
            No properties on record yet.
          </p>
        ) : (
          <PortalCard className="divide-y">
            {sites.map((site) => {
              const address = [site.address, site.suburb, site.state, site.postcode]
                .filter(Boolean)
                .join(', ')
              const dues = site.review_dues ?? []
              const status = derivePortalPropertyStatus(dues, today)
              const { phrase } = propertyStatusPhrase(dues, today)
              return (
                <Link
                  key={site.id}
                  href={`/portal/${token}/sites/${site.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
                >
                  <StatusRing status={status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{site.name}</p>
                    {address && (
                      <p className="flex items-center gap-1 truncate text-xs text-slate-500">
                        <MapPinIcon className="size-3 shrink-0" />
                        <span className="truncate">{address}</span>
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                      <PortalLight status={status} label={phrase} />
                      <span
                        className={`text-xs ${
                          site.open_works > 0 ? 'font-medium text-blue-700' : 'text-slate-400'
                        }`}
                      >
                        {site.open_works === 0
                          ? 'No open works'
                          : `${site.open_works} open work${site.open_works === 1 ? '' : 's'}`}
                      </span>
                    </div>
                  </div>
                  <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
                </Link>
              )
            })}
          </PortalCard>
        )}
      </div>

      {/* Your requests */}
      {openRequests.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Your requests
          </h2>
          <PortalCard className="divide-y">
            {openRequests.slice(0, 5).map((r) => (
              <Link
                key={r.id}
                href={`/portal/${token}/sites/${r.site_id}?tab=requests`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {r.number} — {r.title}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {r.site_name} · {fmtDate(r.created_at)}
                  </p>
                </div>
                <RequestStatusChip status={r.status} />
                <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
              </Link>
            ))}
            {openRequests.length > 5 && (
              <p className="px-4 py-2.5 text-xs text-slate-400">
                +{openRequests.length - 5} more on their property pages
              </p>
            )}
          </PortalCard>
        </div>
      )}
    </PortalShell>
  )
}

function SummaryCard({
  icon,
  iconClass,
  value,
  label,
  valueClass = 'text-slate-900',
}: {
  icon: React.ReactNode
  iconClass: string
  value: string
  label: string
  valueClass?: string
}) {
  return (
    <PortalCard className="flex flex-col gap-2 p-3.5">
      <span className={`flex size-8 items-center justify-center rounded-lg ${iconClass}`}>
        {icon}
      </span>
      <div className="flex flex-col">
        <span className={`truncate text-lg font-bold leading-tight tracking-tight ${valueClass}`}>
          {value}
        </span>
        <span className="text-xs text-slate-500">{label}</span>
      </div>
    </PortalCard>
  )
}
```

- [ ] **Step 3: Typecheck, lint, load**

Run: `npx tsc --noEmit && npm run lint`
Start the dev server (with the CA cert env) and load `http://localhost:3000/portal/<Nick Jones test token>` and `/portal/<token>/properties`. Before the migration is applied `portal_works` is missing: the page must still render (the `?? []` fallback) with "No works under way right now". After it is applied, works appear.
Expected: HTTP 200, no red error overlay, five nav items.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/[token]/page.tsx src/app/portal/[token]/properties/page.tsx
git commit -m "feat: works-first portal overview; properties list moves to /properties"
```

---

### Task 5: Works page and work page

**Files:**
- Create: `src/app/portal/[token]/works/page.tsx`
- Create: `src/app/portal/[token]/works/[kind]/[id]/page.tsx`

**Interfaces:**
- Consumes: `portal_works`, `portal_work_detail`, `portal_my_feedback(p_token, p_site)` (existing; `p_site` null returns all of this link's feedback), `FeedbackCard` (`sites/[siteId]/feedback-card.tsx`, props `{ token, kind, id, companyName }`), `WorkTimeline`, `PhotoGallery`, `DocRows`, `isPhoto`, `HANDOVER_PACK_CAPTION`.

- [ ] **Step 1: Works page**

```tsx
import { redirect } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase/public'
import { workGroupForJob, workGroupForProject } from '@/lib/portal-experience'
import {
  EmptyState,
  isRegisterScope,
  LinkInactivePage,
  PortalShell,
  type PortalBranding,
  type PortalWorkSummary,
} from '../portal-ui'
import { WorkCard } from '../work-ui'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

/** All works for the client — current first, then completed. NO money. */
export default async function PortalWorksPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createPublicClient()

  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: worksData }] = await Promise.all([
    supabase.rpc('portal_works', { p_token: token }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: '/portal/works',
    }),
  ])
  const works = ((worksData ?? []) as PortalWorkSummary[]) ?? []
  const group = (w: PortalWorkSummary) =>
    w.kind === 'job' ? workGroupForJob(w.status) : workGroupForProject(w.status)
  const current = works.filter((w) => group(w) === 'live')
  const completed = works
    .filter((w) => group(w) === 'history')
    .sort((a, b) => (b.completed_on ?? b.from ?? '').localeCompare(a.completed_on ?? a.from ?? ''))

  return (
    <PortalShell branding={branding} token={token} active="works">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Works</h1>
        <p className="text-sm text-slate-500">
          Every job and project {branding.company_name} has under way or completed for you.
        </p>
      </div>

      {works.length === 0 && <EmptyState>No works recorded yet.</EmptyState>}

      {current.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Current
          </h2>
          <ul className="flex flex-col gap-3">
            {current.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <WorkCard token={token} work={w} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {completed.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Completed
          </h2>
          <ul className="flex flex-col gap-3">
            {completed.map((w) => (
              <li key={`${w.kind}-${w.id}`}>
                <WorkCard token={token} work={w} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PortalShell>
  )
}
```

- [ ] **Step 2: Work page**

`src/app/portal/[token]/works/[kind]/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  ArrowLeftIcon,
  CalendarIcon,
  CircleCheckIcon,
  DownloadIcon,
  FileSignatureIcon,
  FileTextIcon,
  MapPinIcon,
  MessageSquareIcon,
} from 'lucide-react'
import { createPublicClient } from '@/lib/supabase/public'
import { fmtDate } from '@/lib/format'
import { HANDOVER_PACK_CAPTION } from '@/lib/feedback'
import { workGroupForJob, workGroupForProject } from '@/lib/portal-experience'
import {
  EmptyState,
  isRegisterScope,
  LinkInactivePage,
  PortalCard,
  PortalShell,
  ProgressBar,
  WorkStatusBadge,
  WorkTimeline,
  type PortalBranding,
  type PortalWorkDetail,
} from '../../../portal-ui'
import { DocRows, isPhoto, PhotoGallery } from '../../../work-ui'
import { FeedbackCard } from '../../../sites/[siteId]/feedback-card'

// Public, token-gated, no auth — always resolve the token fresh, never cache.
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PortalFeedbackRow {
  job_id: string | null
  project_id: string | null
  rating: number
}

/**
 * One work: timeline, dates, linked quote, photos, documents, close-out pack
 * and the feedback card once completed. Entitlement is re-proved by
 * portal_work_detail (null → 404). NO money.
 */
export default async function PortalWorkPage({
  params,
}: {
  params: Promise<{ token: string; kind: string; id: string }>
}) {
  const { token, kind, id } = await params
  if ((kind !== 'job' && kind !== 'project') || !UUID_RE.test(id)) notFound()

  const supabase = createPublicClient()
  const { data: resolved } = await supabase.rpc('portal_resolve_link', {
    p_token: token,
  })
  const branding = (resolved ?? null) as PortalBranding | null
  if (!branding) return <LinkInactivePage />
  if (isRegisterScope(branding)) {
    redirect(`/portal/${token}/sites/${branding.site_id}`)
  }

  const [{ data: detailData }, { data: feedbackData }] = await Promise.all([
    supabase.rpc('portal_work_detail', { p_token: token, p_kind: kind, p_id: id }),
    supabase.rpc('portal_my_feedback', { p_token: token, p_site: null }),
    supabase.rpc('portal_log_view', {
      p_token: token,
      p_site: null,
      p_path: `/portal/works/${kind}/${id}`,
    }),
  ])
  const work = (detailData ?? null) as PortalWorkDetail | null
  if (!work) notFound()

  const feedback = ((feedbackData ?? []) as PortalFeedbackRow[]) ?? []
  const givenRating = feedback.find((f) =>
    work.kind === 'job' ? f.job_id === work.id : f.project_id === work.id
  )?.rating

  const completed =
    (work.kind === 'job' ? workGroupForJob(work.status) : workGroupForProject(work.status)) ===
    'history'
  const photos = work.attachments.filter(isPhoto)
  const handoverPack = work.attachments.find(
    (a) => a.caption === HANDOVER_PACK_CAPTION && !isPhoto(a)
  )
  const docs = work.attachments.filter((a) => !isPhoto(a) && a.id !== handoverPack?.id)
  const dates = [
    work.from ? `From ${fmtDate(work.from)}` : null,
    work.to ? `to ${fmtDate(work.to)}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <PortalShell branding={branding} token={token} active="works">
      <div className="flex flex-col gap-3">
        <Link
          href={`/portal/${token}/works`}
          className="flex min-h-6 w-fit items-center gap-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeftIcon className="size-3.5" />
          All works
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              {work.number}
            </p>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{work.title}</h1>
            {work.site_id ? (
              <Link
                href={`/portal/${token}/sites/${work.site_id}`}
                className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"
              >
                <MapPinIcon className="size-3.5 shrink-0" />
                <span className="truncate">
                  {work.site_name}
                  {work.site_address ? ` — ${work.site_address}` : ''}
                </span>
              </Link>
            ) : (
              <p className="text-sm text-slate-400">No property recorded</p>
            )}
          </div>
          <WorkStatusBadge status={work.status} />
        </div>
      </div>

      {/* Progress */}
      <PortalCard className="flex flex-col gap-4 p-4 sm:p-5">
        <WorkTimeline kind={work.kind} status={work.status} />
        {dates && (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarIcon className="size-3.5 text-slate-400" />
            {dates}
          </p>
        )}
        {work.progress_pct !== null && <ProgressBar pct={work.progress_pct} />}
        {work.description && (
          <p className="whitespace-pre-wrap text-sm text-slate-600">{work.description}</p>
        )}
      </PortalCard>

      {/* Quote */}
      {work.quote && (
        <Link
          href={`/portal/${token}/approvals/quote/${work.quote.id}`}
          className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm transition-all hover:border-slate-300 hover:shadow"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[#162040]">
            {work.quote.decided === 'accepted' || work.quote.status === 'accepted' ? (
              <CircleCheckIcon className="size-5 text-green-600" />
            ) : (
              <FileSignatureIcon className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">
              Quotation {work.quote.number}
            </span>
            <span className="block text-xs text-slate-500">
              {work.quote.status === 'accepted'
                ? 'Accepted — view the signed quotation'
                : work.quote.status === 'sent'
                  ? 'Awaiting your approval'
                  : 'View the quotation'}
            </span>
          </span>
          <FileTextIcon className="size-4 shrink-0 text-slate-300" />
        </Link>
      )}

      {/* Close-out pack */}
      {handoverPack && (
        <a
          href={`/portal/${token}/file/attachment/${handoverPack.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[#162040] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          <FileTextIcon className="size-4" />
          Close-out pack
          <DownloadIcon className="size-3.5 opacity-70" />
        </a>
      )}

      {/* Photos */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Photos{photos.length > 0 ? ` (${photos.length})` : ''}
        </h2>
        {photos.length === 0 ? (
          <EmptyState>No photos shared for this work yet.</EmptyState>
        ) : (
          <PhotoGallery token={token} photos={photos} />
        )}
      </div>

      {/* Documents */}
      {docs.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Documents
          </h2>
          <DocRows token={token} docs={docs} />
        </div>
      )}

      {/* Feedback once completed */}
      {completed &&
        (givenRating ? (
          <p className="text-xs font-medium text-slate-500">
            {'★'.repeat(givenRating)}
            <span className="text-slate-300">{'★'.repeat(5 - givenRating)}</span> Thanks for
            your feedback
          </p>
        ) : (
          <FeedbackCard
            token={token}
            kind={work.kind}
            id={work.id}
            companyName={branding.company_name}
          />
        ))}

      {work.site_id && (
        <Link
          href={`/portal/${token}/sites/${work.site_id}?tab=messages`}
          className="flex min-h-11 w-fit items-center gap-2 rounded-xl border bg-white px-3.5 text-sm font-medium text-[#162040] transition-colors hover:bg-slate-50"
        >
          <MessageSquareIcon className="size-4" />
          Message us about this work
        </Link>
      )}
    </PortalShell>
  )
}
```

`FeedbackCard` takes exactly `{ token, kind, id, companyName }` (verified) — no site is needed.

- [ ] **Step 3: Typecheck, lint, load**

Run: `npx tsc --noEmit && npm run lint`
Load `/portal/<token>/works` and, once 0062 is applied, `/portal/<token>/works/job/<a job id of that client>`; also `/portal/<token>/works/job/00000000-0000-0000-0000-000000000000` → 404 page.
Expected: 200 / 404 as above, no error overlay.

- [ ] **Step 4: Commit**

```bash
git add src/app/portal/[token]/works
git commit -m "feat: portal Works list and per-work page (timeline, quote, photos, documents, close-out pack, feedback)"
```

---

### Task 6: Property page adjustments

**Files:**
- Modify: `src/app/portal/[token]/sites/[siteId]/page.tsx`

- [ ] **Step 1: Status helper + empty copy + work links**

1. Replace the `derivePropertyStatus` import with `derivePortalPropertyStatus` (from `@/lib/portal`) and use it for `siteStatus`.
2. Compliance tab empty state: replace `No compliance documents on record for this property yet.` with
   `No compliance register is kept for this property. Ask us if you would like one set up.`
3. In the Works tab, both the "Current works" card and each "Works history" entry get a link to the work page. Current works: wrap the number/title block in
   ```tsx
   <Link href={`/portal/${token}/works/${w.kind}/${w.id}`} className="flex min-w-0 flex-col gap-0.5 hover:underline">
   ```
   and pass `limit={6}` to that card's `<PhotoGallery>`. Works history: same link around the title `<p>`, `limit={6}` on its gallery, and under the gallery add
   ```tsx
   <Link
     href={`/portal/${token}/works/${w.kind}/${w.id}`}
     className="flex min-h-6 w-fit items-center gap-1 text-xs font-medium text-[#162040] hover:underline"
   >
     View this work <ChevronRightIcon className="size-3.5" />
   </Link>
   ```
4. The "All properties" back link now points at `/portal/${token}/properties`.

- [ ] **Step 2: Typecheck, lint, load**

Run: `npx tsc --noEmit && npm run lint`
Load `/portal/<token>/sites/<siteId>` for the Ducat site (has a register) and for a site with none (`?tab=works` too).
Expected: 200s; the no-register site shows a grey ring and the new empty copy.

- [ ] **Step 3: Commit**

```bash
git add src/app/portal/[token]/sites/[siteId]/page.tsx
git commit -m "feat: property page — neutral no-register state, works link to their pages"
```

---

### Task 7: Quotes page — office-decided items

**Files:**
- Modify: `src/app/portal/[token]/approvals/page.tsx`
- Modify: `src/app/portal/[token]/approvals/[kind]/[id]/page.tsx`

- [ ] **Step 1: List page**

Change the heading/intro to `Quotes & approvals` / `Quotes and variations to review and sign, plus everything already decided.` and the back link to `/portal/${token}` labelled `Overview`.

Split `approvals.decided` into two groups before the JSX:

```ts
const signed = approvals.decided.filter((d) => d.source !== 'office')
const officeDecided = approvals.decided.filter((d) => d.source === 'office')
```

Render the existing "Signed through the portal" card from `signed`. Below it add:

```tsx
{officeDecided.length > 0 && (
  <div className="flex flex-col gap-3">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
      Decided
    </h2>
    <PortalCard className="divide-y">
      {officeDecided.map((item) => (
        <Link
          key={`${item.kind}-${item.id}`}
          href={`/portal/${token}/approvals/${item.kind}/${item.id}`}
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50"
        >
          {item.action === 'accepted' ? (
            <CircleCheckIcon className="size-5 shrink-0 text-green-600" />
          ) : (
            <XCircleIcon className="size-5 shrink-0 text-red-500" />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">
              {item.number} — {item.title}
            </p>
            <p className="truncate text-xs text-slate-500">
              {item.action === 'accepted' ? 'Accepted' : 'Declined'}
              {item.signed_on ? ` on ${fmtDate(item.signed_on)}` : ''}
            </p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-slate-300" />
        </Link>
      ))}
    </PortalCard>
  </div>
)}
```

(Check the existing "Signed through the portal" rows: if they are plain `<div>`s, leave them; the detail page still handles both.)

- [ ] **Step 2: Detail page**

In the decided card, replace the sentence so office-decided items don't claim a signer:

```tsx
<p className="text-sm font-semibold text-slate-900">
  {decided.action === 'accepted' ? 'Accepted' : 'Declined'}
  {decided.signer_name ? ` by ${decided.signer_name}` : ''}
  {decided.signed_on ? ` on ${fmtDate(decided.signed_on)}` : ''}
</p>
<p className="text-sm text-slate-500">
  {decided.source === 'office'
    ? decided.action === 'accepted'
      ? 'This quotation was accepted and is on record.'
      : 'This quotation was not proceeded with.'
    : decided.action === 'accepted'
      ? 'This document has been signed through the portal.'
      : 'Our team has been notified and will be in touch.'}
</p>
```

Change the back link label to `All quotes`.

- [ ] **Step 3: Typecheck, lint, load, commit**

Run: `npx tsc --noEmit && npm run lint`; load `/portal/<token>/approvals`.

```bash
git add src/app/portal/[token]/approvals
git commit -m "feat: portal quotes page shows office-decided quotes and variations"
```

---

### Task 8: Per-work "Share with client" switch

**Files:**
- Create: `src/lib/work-sharing.ts`
- Create: `src/components/ShareWithClientSwitch.tsx`
- Modify: `src/lib/attachments.ts` (`recordAttachment`, `setAttachmentClientVisible`)
- Modify: `src/lib/handover.ts` (insert)
- Modify: `src/app/(office)/jobs/[id]/page.tsx` (action row), `src/app/(office)/projects/[id]/layout.tsx` (header), `src/app/(office)/projects/[id]/diary/diary-list.tsx` (photos), `src/app/(office)/clients/[id]/page.tsx` (Jobs/Projects tables), `src/app/(office)/clients/[id]/sites/[siteId]/page.tsx` (works table)

**Interfaces:**
- Produces: `setWorkClientShared(kind: 'job'|'project', id: string, shared: boolean): Promise<{ error?: string; photos?: number; documents?: number }>`; `<ShareWithClientSwitch kind id shared clientName />`.
- Consumes: `jobs.client_shared`, `projects.client_shared` (Task 2).

- [ ] **Step 1: work-sharing.ts**

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * The per-work "Share with client" switch. ON: the work's photos, documents
 * and PDFs (incl. the close-out pack; for projects also diary photos) become
 * client_visible and new uploads default visible. OFF: all of them hide
 * again. Dockets never share. The per-attachment eye toggle still wins
 * afterwards — this only sets the starting state.
 */
export async function setWorkClientShared(
  kind: 'job' | 'project',
  id: string,
  shared: boolean
): Promise<{ error?: string; photos?: number; documents?: number }> {
  await requireRole('admin', 'office')
  if (kind !== 'job' && kind !== 'project') return { error: 'Unknown work kind' }

  const supabase = await createClient()
  const table = kind === 'job' ? 'jobs' : 'projects'

  const { data: work, error: workError } = await supabase
    .from(table)
    .update({ client_shared: shared })
    .eq('id', id)
    .select('id')
    .maybeSingle()
  if (workError) return { error: workError.message }
  if (!work) return { error: 'Work not found' }

  // Diary photos belong to the project through diaries.project_id.
  let diaryIds: string[] = []
  if (kind === 'project') {
    const { data: diaries } = await supabase.from('diaries').select('id').eq('project_id', id)
    diaryIds = (diaries ?? []).map((d) => d.id as string)
  }

  const shareable = ['photo', 'document', 'pdf']
  const { data: own } = await supabase
    .from('attachments')
    .select('id, kind')
    .eq('parent_type', kind)
    .eq('parent_id', id)
    .in('kind', shareable)
  const { data: diary } =
    diaryIds.length > 0
      ? await supabase
          .from('attachments')
          .select('id, kind')
          .eq('parent_type', 'diary')
          .in('parent_id', diaryIds)
          .in('kind', shareable)
      : { data: [] as { id: string; kind: string }[] }

  const rows = [...(own ?? []), ...(diary ?? [])]
  if (rows.length > 0) {
    const { error } = await supabase
      .from('attachments')
      .update({ client_visible: shared })
      .in(
        'id',
        rows.map((r) => r.id as string)
      )
    if (error) return { error: error.message }
  }

  revalidatePath(`/${table}/${id}`)
  if (kind === 'project') {
    revalidatePath(`/projects/${id}/documents`)
    revalidatePath(`/projects/${id}/diary`)
  }

  return {
    photos: rows.filter((r) => r.kind === 'photo').length,
    documents: rows.filter((r) => r.kind !== 'photo').length,
  }
}
```

- [ ] **Step 2: attachments.ts — default visibility + diary curation**

Add a helper above `recordAttachment`:

```ts
/**
 * A new photo/document/PDF on a SHARED job or project (or a diary of a shared
 * project) starts client-visible. Dockets and every other parent stay hidden.
 */
async function defaultClientVisible(
  supabase: Awaited<ReturnType<typeof createClient>>,
  parentType: string,
  parentId: string,
  kind: string
): Promise<boolean> {
  if (kind === 'docket') return false
  if (parentType === 'job' || parentType === 'project') {
    const { data } = await supabase
      .from(parentType === 'job' ? 'jobs' : 'projects')
      .select('client_shared')
      .eq('id', parentId)
      .maybeSingle()
    return Boolean(data?.client_shared)
  }
  if (parentType === 'diary') {
    const { data } = await supabase
      .from('diaries')
      .select('projects(client_shared)')
      .eq('id', parentId)
      .maybeSingle()
    const project = data?.projects as unknown as { client_shared: boolean } | null
    return Boolean(project?.client_shared)
  }
  return false
}
```

In `recordAttachment`, after the parent-existence check and before the insert:

```ts
  const clientVisible = await defaultClientVisible(
    supabase,
    parsed.data.parent_type,
    parsed.data.parent_id,
    parsed.data.kind
  )
```

and add `client_visible: clientVisible,` to the inserted object.

In `setAttachmentClientVisible` replace the parent-type guard and the revalidate:

```ts
  if (row.parent_type !== 'job' && row.parent_type !== 'project' && row.parent_type !== 'diary') {
    return { error: 'Only job, project and diary attachments can be shared to the portal' }
  }
  …
  if (row.parent_type === 'diary') {
    const { data: diary } = await supabase
      .from('diaries')
      .select('project_id')
      .eq('id', row.parent_id)
      .maybeSingle()
    if (diary?.project_id) revalidatePath(`/projects/${diary.project_id}/diary`)
  } else {
    await revalidateParent(supabase, row.parent_type, row.parent_id)
  }
  return {}
```

Update the doc comment above the function to say job/project/diary.

- [ ] **Step 3: handover.ts — pack follows the switch**

Before the `attachments` insert:

```ts
  const { data: work } = await supabase
    .from(kind === 'job' ? 'jobs' : 'projects')
    .select('client_shared')
    .eq('id', id)
    .maybeSingle()
```

and add `client_visible: Boolean(work?.client_shared),` to the insert. Update the file's doc comment: "lands visible when the work is shared with the client, hidden otherwise".

- [ ] **Step 4: ShareWithClientSwitch.tsx**

```tsx
'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { GlobeIcon, GlobeLockIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setWorkClientShared } from '@/lib/work-sharing'

/**
 * The per-work "Share with client" switch (admin/office). ON = the work's
 * photos, documents and close-out pack show in the client portal (dockets
 * never do); office can still hide single items with the eye toggle.
 */
export function ShareWithClientSwitch({
  kind,
  id,
  shared,
  clientName,
}: {
  kind: 'job' | 'project'
  id: string
  shared: boolean
  clientName: string
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggle() {
    const next = !shared
    if (
      !next &&
      !confirm(
        `Hide everything from the client portal? ${clientName} will no longer see this work's photos, documents or close-out pack.`
      )
    ) {
      return
    }
    startTransition(async () => {
      const result = await setWorkClientShared(kind, id, next)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const photos = result.photos ?? 0
      const documents = result.documents ?? 0
      toast.success(
        next
          ? `Shared with ${clientName} — ${photos} photo${photos === 1 ? '' : 's'} and ${documents} document${documents === 1 ? '' : 's'} are now in their portal. New uploads will be visible too; use the eye toggle to hide any single item.`
          : `Hidden from ${clientName}'s portal`
      )
      router.refresh()
    })
  }

  return (
    <Button
      type="button"
      variant={shared ? 'default' : 'outline'}
      size="sm"
      disabled={pending}
      onClick={toggle}
      title="Photos, documents and the close-out pack appear in the client portal. Dockets never do."
    >
      {shared ? <GlobeIcon /> : <GlobeLockIcon />}
      {pending ? 'Saving…' : shared ? 'Shared with client' : 'Share with client'}
    </Button>
  )
}
```

- [ ] **Step 5: Placements**

`jobs/[id]/page.tsx` — the jobs query already selects `*`, so `job.client_shared` exists. In the `StatusActions` block:

```tsx
        {canMutate && (
          <div className="flex flex-wrap items-center gap-2">
            <StatusActions
              jobId={job.id}
              status={job.status}
              scheduledStart={job.scheduled_start ?? null}
            />
            {canDeleteAttachment && (
              <ShareWithClientSwitch
                kind="job"
                id={job.id}
                shared={Boolean(job.client_shared)}
                clientName={clientRel?.name ?? 'the client'}
              />
            )}
          </div>
        )}
```

(`canDeleteAttachment` is the existing admin/office flag on that page.) Import the component.

`projects/[id]/layout.tsx` — add `client_shared` to the select, and in the status row after `ProjectStatusSelect`/`StatusBadge`:

```tsx
          {canMutate && (
            <ShareWithClientSwitch
              kind="project"
              id={project.id}
              shared={Boolean(project.client_shared)}
              clientName={clientRel?.name ?? 'the client'}
            />
          )}
```

`projects/[id]/diary/diary-list.tsx` — both `<AttachmentList items={photos} …>` calls gain `canCurate={canManage}`.

`clients/[id]/page.tsx` — add `client_shared` to the jobs and projects selects; add a `Portal` column head after Status in both tables and a cell:

```tsx
<TableCell>
  {j.client_shared ? (
    <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">Shared</Badge>
  ) : (
    <span className="text-xs text-muted-foreground">Not shared</span>
  )}
</TableCell>
```

(`Badge` from `@/components/ui/badge` — import if missing; same cell for projects with `p`.)

`clients/[id]/sites/[siteId]/page.tsx` — add `client_shared` to the jobs/projects selects and the same Portal column to the "Works on this property" table.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`
With 0062 applied, in the office app: open a job, click **Share with client** → toast with counts, badge on client page shows Shared; job photo eye icons now green; upload a photo → it is visible; click the switch again → confirm → everything hidden. On a project: switch in the header; diary photos get the eye toggle.
Expected: all of the above; the portal work page for that job shows/hides the photos accordingly.

- [ ] **Step 7: Commit**

```bash
git add src/lib/work-sharing.ts src/components/ShareWithClientSwitch.tsx src/lib/attachments.ts src/lib/handover.ts "src/app/(office)/jobs/[id]/page.tsx" "src/app/(office)/projects/[id]/layout.tsx" "src/app/(office)/projects/[id]/diary/diary-list.tsx" "src/app/(office)/clients/[id]/page.tsx" "src/app/(office)/clients/[id]/sites/[siteId]/page.tsx"
git commit -m "feat: per-work Share with client switch; new uploads and close-out packs follow it; diary photo curation; Portal column"
```

---

### Task 9: Quotes publish on send + client email

**Files:**
- Modify: `src/lib/email.ts` (templates)
- Modify: `src/lib/notify.ts` (+ `notifyClientQuoteSent`)
- Modify: `src/app/(office)/quotes/actions.ts` (`setQuoteStatus`, `setQuotePortalPublished` comment)
- Modify: `src/app/(office)/quotes/[id]/quote-builder.tsx` (publish block)
- Test: `tests/email.test.ts`

**Interfaces:**
- Produces: templates `'client_quote_sent'`, `'client_portal_invite'`; `notifyClientQuoteSent({ quoteId }): Promise<void>`.

- [ ] **Step 1: Failing test**

Append to `tests/email.test.ts`:

```ts
import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_LABELS } from '@/lib/email'

describe('email template registry', () => {
  it('registers the quote-sent and portal-invite client templates with labels', () => {
    expect(EMAIL_TEMPLATES).toContain('client_quote_sent')
    expect(EMAIL_TEMPLATES).toContain('client_portal_invite')
    expect(EMAIL_TEMPLATE_LABELS.client_quote_sent).toBe('Client — quote ready to sign')
    expect(EMAIL_TEMPLATE_LABELS.client_portal_invite).toBe('Client — portal invite')
  })
})
```

Run: `npx vitest run tests/email.test.ts --maxWorkers=1` → FAIL (not in the list).

- [ ] **Step 2: Templates**

In `src/lib/email.ts` add `'client_quote_sent', 'client_portal_invite',` to `EMAIL_TEMPLATES` (before `'test'`) and to the labels:

```ts
  client_quote_sent: 'Client — quote ready to sign',
  client_portal_invite: 'Client — portal invite',
```

Run the test again → PASS.

- [ ] **Step 3: notifyClientQuoteSent**

Append to `src/lib/notify.ts` after `notifyClientInvoiceSent`:

```ts
/**
 * Client update: a quote was marked sent (and therefore published to the
 * portal). Deep-links to the sign-on-the-glass page. Office action context.
 */
export async function notifyClientQuoteSent(input: { quoteId: string }): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: quote } = await supabase
      .from('quotes')
      .select('id, number, title, client_id')
      .eq('id', input.quoteId)
      .single()
    if (!quote) return

    const [{ data: contacts }, { data: links }, { data: settings }] = await Promise.all([
      supabase.from('contacts').select('name, email').eq('client_id', quote.client_id).order('name'),
      supabase
        .from('client_links')
        .select('id, token, revoked_at, expires_at')
        .eq('client_id', quote.client_id)
        .order('created_at', { ascending: false }),
      supabase.from('settings').select('company_name').eq('id', 1).single(),
    ])

    const link = pickLiveLink((links ?? []) as LinkRow[])
    const base = appBaseUrl()
    const portalUrl =
      base && link ? `${base}/portal/${link.token}/approvals/quote/${quote.id}` : null
    const company = settings?.company_name ?? 'Entice'

    await sendEmail({
      to: primaryContactEmail((contacts ?? []) as ContactRow[]),
      subject: `Quotation ${quote.number} from ${company}`,
      template: 'client_quote_sent',
      entityKind: 'quote',
      entityId: quote.id as string,
      html: renderEmail({
        companyName: company,
        heading: 'Your quotation is ready',
        intro: `${company} has issued quotation ${quote.number} — ${quote.title}. You can review the full document and accept it online.`,
        cta: portalUrl ? { label: 'Review and sign in your portal', url: portalUrl } : null,
        footnote: portalUrl
          ? null
          : 'Ask us for a portal link to review and sign your quotations online.',
      }),
    })
  } catch (err) {
    console.error('[notify] client quote-sent email failed:', err)
  }
}
```

- [ ] **Step 4: setQuoteStatus publishes on send**

In `src/app/(office)/quotes/actions.ts`, import `notifyClientQuoteSent` from `@/lib/notify` (extend the existing import) and change the draft→sent branch and the tail of `setQuoteStatus`:

```ts
  if (target === 'sent' && quote.status === 'draft') {
    // Sent quotes go straight onto the client portal (Unpublish opts out).
    update = { status: 'sent', sent_at: now, portal_published: true }
  }
  …
  const { error } = await supabase.from('quotes').update(update).eq('id', id)
  if (error) return { error: error.message }

  if (target === 'sent') {
    // Fire-and-forget after the response; the email engine skip-logs until
    // sending is configured.
    after(() => notifyClientQuoteSent({ quoteId: id }))
  }

  revalidateQuote(id)
  return {}
```

Update the comment above `setQuotePortalPublished` to: "Sent quotes publish automatically on send; office can unpublish, and re-publish sent or accepted quotes (canPublishQuote)."

- [ ] **Step 5: Quote builder block**

Replace `{quote.status === 'sent' && (` with `{canPublishQuote(quote.status) && (` (import `canPublishQuote` from `@/lib/portal-interactions`) and the copy inside:

```tsx
              {quote.portal_published ? (
                <span>
                  <span className="font-medium">On the client portal</span>
                  {' — '}
                  <span className="text-muted-foreground">
                    {quote.status === 'sent'
                      ? `${quote.client_name} can view the PDF and sign online.`
                      : `${quote.client_name} can view the accepted quotation.`}
                  </span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Not on the client portal — publish so {quote.client_name} can view
                  {quote.status === 'sent' ? ' and sign' : ''} this quote online.
                </span>
              )}
```

Keep the Unpublish/Publish button as is.

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`
Click check: mark a `zz` draft quote sent → the builder shows "On the client portal"; Settings → Email log gains a `client_quote_sent` row (status skipped); the portal Quotes page lists it under "Awaiting your approval". Delete the `zz` quote afterwards.

```bash
git add src/lib/email.ts src/lib/notify.ts "src/app/(office)/quotes/actions.ts" "src/app/(office)/quotes/[id]/quote-builder.tsx" tests/email.test.ts
git commit -m "feat: quotes publish to the portal on send with a client email; accepted quotes can be re-published"
```

---

### Task 10: Portal invite email + office UI

**Files:**
- Modify: `src/lib/zod.ts` (schema after `clientLinkCreateSchema`)
- Modify: `src/lib/client-links.ts` (+ `sendClientLinkInvite`)
- Modify: `src/app/(office)/clients/[id]/portal-links.tsx`
- Modify: `src/app/(office)/clients/[id]/page.tsx` (pass `contacts` + `companyName`)

**Interfaces:**
- Produces: `sendClientLinkInvite(data): Promise<{ status: 'sent'|'skipped'|'failed'; to: string } | { error: string }>`; `PortalLinks` gains props `contacts: { id: string; name: string; email: string | null }[]` and `companyName: string`.
- Consumes: `portalInviteMessage` (Task 1), template `client_portal_invite` (Task 9).

- [ ] **Step 1: zod schema**

After `clientLinkCreateSchema` in `src/lib/zod.ts`:

```ts
export const clientLinkInviteSchema = z.object({
  link_id: z.uuid(),
  client_id: z.uuid(),
  contact_id: z.uuid('Pick a contact'),
  note: z.string().max(1000).nullish(),
  origin: z.string().nullish(),
})
export type ClientLinkInviteInput = z.infer<typeof clientLinkInviteSchema>
```

- [ ] **Step 2: sendClientLinkInvite**

Append to `src/lib/client-links.ts` (extend the imports: `clientLinkInviteSchema` from zod, `renderEmail, sendEmail` from `@/lib/email`, `isClientLinkActive, portalInviteMessage` from `@/lib/portal`):

```ts
/**
 * Emails a client contact their portal invite (branded, through the email
 * engine — logged as 'skipped' until RESEND_API_KEY/EMAIL_FROM exist).
 * The link must be live and both link and contact must belong to the client.
 */
export async function sendClientLinkInvite(
  data: unknown
): Promise<{ status: 'sent' | 'skipped' | 'failed'; to: string } | { error: string }> {
  await requireRole('admin', 'office')

  const parsed = clientLinkInviteSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { link_id, client_id, contact_id, note } = parsed.data

  const supabase = await createClient()
  const [{ data: link }, { data: contact }, { data: client }, { data: settings }] =
    await Promise.all([
      supabase
        .from('client_links')
        .select('id, token, client_id, revoked_at, expires_at, scope')
        .eq('id', link_id)
        .eq('client_id', client_id)
        .maybeSingle(),
      supabase
        .from('contacts')
        .select('id, name, email')
        .eq('id', contact_id)
        .eq('client_id', client_id)
        .maybeSingle(),
      supabase.from('clients').select('name').eq('id', client_id).single(),
      supabase.from('settings').select('company_name').eq('id', 1).single(),
    ])

  if (!link || !isClientLinkActive(link)) return { error: 'That portal link is not active' }
  if (link.scope === 'register') return { error: 'Register-scope links are for QR posters, not invites' }
  if (!contact) return { error: 'Contact not found' }
  const to = contact.email?.trim()
  if (!to) return { error: `${contact.name} has no email address on record` }

  const company = settings?.company_name ?? 'Entice'
  const clientName = client?.name ?? 'your organisation'
  const url = `${safeOrigin(parsed.data.origin ?? null)}/portal/${link.token}`

  const result = await sendEmail({
    to,
    subject: `Your ${company} client portal`,
    template: 'client_portal_invite',
    entityKind: 'client_link',
    entityId: link.id as string,
    html: renderEmail({
      companyName: company,
      heading: `Your ${company} client portal`,
      intro: `${company} has set up a secure online portal for ${clientName}. Use it to review and sign quotes, follow works in progress, view photos and close-out reports, and request new work.`,
      quote: note?.trim() || null,
      cta: { label: 'Open your portal', url },
      footnote: 'Keep this link private — anyone with it can view your portal.',
    }),
  })

  revalidatePath(`/clients/${client_id}`)
  return { status: result.status, to }
}
```

`portalInviteMessage` is used by the client component (Step 3), not here — drop it from this import if lint flags it unused.

- [ ] **Step 3: portal-links.tsx — invite panel**

Add props and an `InvitePanel` client component inside the file:

```tsx
import { MailIcon } from 'lucide-react'          // extend the lucide import
import { Textarea } from '@/components/ui/textarea'
import { portalInviteMessage } from '@/lib/portal'
import { sendClientLinkInvite } from '@/lib/client-links'  // extend that import

export interface ClientContactOption {
  id: string
  name: string
  email: string | null
}

function InvitePanel({
  linkId,
  clientId,
  clientName,
  companyName,
  url,
  contacts,
  onDone,
}: {
  linkId: string
  clientId: string
  clientName: string
  companyName: string
  url: string
  contacts: ClientContactOption[]
  onDone?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const withEmail = contacts.filter((c) => c.email && c.email.trim() !== '')
  const [contactId, setContactId] = useState(withEmail[0]?.id ?? '')
  const [note, setNote] = useState('')

  function copyMessage() {
    navigator.clipboard
      .writeText(portalInviteMessage(companyName, clientName, url))
      .then(() => toast.success('Invite message copied'))
      .catch(() => toast.error('Could not copy — copy it manually'))
  }

  function send(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const result = await sendClientLinkInvite({
        link_id: linkId,
        client_id: clientId,
        contact_id: contactId,
        note: note || null,
        origin: window.location.origin,
      })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (result.status === 'sent') toast.success(`Invite emailed to ${result.to}`)
      else if (result.status === 'skipped')
        toast.warning(
          "Invite logged but not sent — email sending isn't configured yet (Settings → Email). Copy the invite message instead."
        )
      else toast.error('The email provider rejected the invite — see Settings → Email')
      onDone?.()
    })
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-contact">Send to</Label>
        {withEmail.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No contacts with an email address — add one under Contacts, or copy the message.
          </p>
        ) : (
          <select
            id="invite-contact"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="h-9 rounded-md border bg-background px-2 text-base md:text-sm"
          >
            {withEmail.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} — {c.email}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-note">Personal note (optional)</Label>
        <Textarea
          id="invite-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="Hi Sam, here's the portal we talked about — your quote is ready to sign."
        />
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={copyMessage}>
          <CopyIcon />
          Copy invite message
        </Button>
        <Button type="submit" disabled={pending || withEmail.length === 0}>
          <MailIcon />
          {pending ? 'Sending…' : 'Send invite'}
        </Button>
      </DialogFooter>
    </form>
  )
}
```

`IssueLinkDialog`: add props `clientName`, `companyName`, `contacts`; after issuing, render the URL row as today and then `<InvitePanel linkId={issuedId} clientId={clientId} clientName={clientName} companyName={companyName} url={issuedUrl} contacts={contacts} onDone={close} />` — store `issuedId` from `result.id` alongside `issuedUrl`. Keep the Done button.

Row action: add to the active-link action cell (before the copy button):

```tsx
<Button
  type="button"
  variant="ghost"
  size="icon-sm"
  onClick={() => setInviteLink(link)}
  aria-label={`Send invite for ${link.label ?? 'this link'}`}
>
  <MailIcon />
</Button>
```

with `const [inviteLink, setInviteLink] = useState<ClientLinkRow | null>(null)` in `PortalLinks` and a dialog:

```tsx
<Dialog open={!!inviteLink} onOpenChange={(o) => !o && setInviteLink(null)}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>Send portal invite</DialogTitle>
    </DialogHeader>
    {inviteLink && (
      <InvitePanel
        linkId={inviteLink.id}
        clientId={clientId}
        clientName={clientName}
        companyName={companyName}
        url={portalUrl(inviteLink.token)}
        contacts={contacts}
        onDone={() => setInviteLink(null)}
      />
    )}
  </DialogContent>
</Dialog>
```

`PortalLinks` props gain `contacts: ClientContactOption[]` and `companyName: string`; pass both into `IssueLinkDialog`. The mail action shows for `canManage` only.

- [ ] **Step 4: Client page wiring**

In `clients/[id]/page.tsx` fetch `settings` (`supabase.from('settings').select('company_name').eq('id', 1).single()`) in the `Promise.all` and pass:

```tsx
      <PortalLinks
        …existing props…
        contacts={(contacts ?? []).map((c) => ({ id: c.id as string, name: c.name as string, email: (c.email as string | null) ?? null }))}
        companyName={settings?.company_name ?? 'Entice'}
      />
```

- [ ] **Step 5: Verify + commit**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`
Click check on a `zz` client with one contact: Issue portal link → invite panel → Send invite → warning toast (skipped) and a `client_portal_invite` row in Settings → Email; Copy invite message → clipboard text matches `portalInviteMessage`; mail icon on the row opens the same panel. Revoke the link and delete the `zz` client afterwards.

```bash
git add src/lib/zod.ts src/lib/client-links.ts "src/app/(office)/clients/[id]/portal-links.tsx" "src/app/(office)/clients/[id]/page.tsx"
git commit -m "feat: emailed portal invite with contact picker and copy-ready message"
```

---

### Task 11: Live proofs, README, final verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: RPC boundary proofs (after 0062 is applied; via the ecr-portal MCP `rpc`/`sql` tools or `psql`)**

Create `zz` fixtures through the office app or the agent API: client `zz Portal Proof` with one contact, one site, one job (status `scheduled`, `client_shared=false`) with one photo attachment, one project with a diary photo, one quote (status `accepted`, `portal_published=true`, no acceptance row), and a full-scope link. Then prove:

| Call | Expect |
|---|---|
| `portal_works(token)` | one job + one project; `photo_count` 0 for both |
| after `setWorkClientShared('job', …, true)` → `portal_works` | job `photo_count` 1 |
| `portal_work_detail(token, 'job', <other client's job>)` | `null` |
| `portal_work_detail(<register-scope token>, 'job', <own job>)` | `null` |
| `portal_approvals(token)` | the accepted quote in `decided` with `source: 'office'`, `signer_name: null` |
| `portal_approval_file(token, 'quote', <id>)` | `{ number }` (not null) |
| `portal_site_detail(token, site)` → project attachments | includes the diary photo only after the project is shared |
| `portal_file_path(token, 'attachment', <diary photo id>)` | path when shared, `null` when not |
| `portal_works(<dead token>)` | `null` |

Delete every `zz` row (attachments + storage objects, diary, job, project, quote, link, site, contact, client) afterwards and confirm with `select count(*) from clients where name like 'zz%'` → 0.

- [ ] **Step 2: README**

Replace the Phase 2 backlog line `- Client portal (read-only claim/variation visibility)` with nothing (delete it) and add a section before `## WHS & Traceability`:

```markdown
## Client portal

Each client organisation gets a no-login portal link (`/portal/{token}`, issued and revoked from the client page, delivered by the **Send invite** email or the copy-ready message). The portal opens on an **Overview** of the client's works and quotes, with **Works** (one page per job/project: status timeline, dates, photos, documents, close-out pack, feedback), **Quotes** (sign on the glass; office-decided quotes stay on record), **Properties** (compliance register, documents, maintenance, messages, requests, optional billing) and a **Calendar**. Properties without a register show a neutral state, never a warning.

**Sharing.** Nothing reaches the portal until office acts. The **Share with client** switch on a job or project publishes its photos, documents and close-out pack in one go (dockets never share, project diary photos ride the project switch); the per-attachment eye toggle still hides single items. Marking a quote **sent** publishes it automatically and emails the client; **Unpublish** opts out.

**Security model.** Anonymous portal reads go through `SECURITY DEFINER` RPCs validated by `portal_live_link(token)`; every page view and download is logged to `portal_views`. Client emails go through `src/lib/email.ts`, which logs as *skipped* until `RESEND_API_KEY` and `EMAIL_FROM` are set.
```

- [ ] **Step 3: Full verification**

Run: `npx tsc --noEmit && npm run lint && npx vitest run --maxWorkers=1`
Expected: clean, all tests pass.

After deploy (owner applied 0062 first): HTTP-load on `https://entice-pink.vercel.app` with the Nick Jones test token: `/portal/<t>`, `/works`, `/works/<kind>/<id>`, `/approvals`, `/properties`, `/calendar`, `/request`, `/sites/<id>` with every `?tab=`. All 200, no "Application error".

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: client portal section — works-first overview, sharing switch, quotes and invites"
```

---

## Self-review notes

- Spec §3.1–3.7 → Tasks 3–7. §4 → Task 8 (+ Task 1 `canPublishQuote`). §5 → Task 2. §6 → Tasks 9–10. §7 office table → Tasks 8–10. §9 tests → Tasks 1, 9, 11. §10 rollout → Task 2 step 4 + Task 11.
- `summarisePortfolio` needs no change: it already counts zero-item sites as `untracked`, not `overdue`; the Overview only shows the compliance card when a register exists.
- Names used consistently: `derivePortalPropertyStatus`, `PortalPropertyStatus`, `workTimelineIndex`, `WorkTimeline`, `PortalWorkSummary`, `PortalWorkDetail`, `WorkCard`, `setWorkClientShared`, `ShareWithClientSwitch`, `sendClientLinkInvite`, `notifyClientQuoteSent`, `portalInviteMessage`, `client_portal_invite`, `client_quote_sent`.
