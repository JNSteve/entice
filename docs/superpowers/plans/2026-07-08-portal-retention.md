# Client Portal Retention Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal the place ECR's clients keep their property compliance living: due items become one-tap re-inspection requests, clients can file their own documents (office-reviewed), the office sees who's gone quiet, clients get a board-ready compliance report PDF, and each site gets an "asbestos register — scan to view" QR poster.

**Architecture:** Five features on the existing CP1–CP3 rails: anon access ONLY via SECURITY DEFINER RPCs validated against `portal_live_link(token)`; office writes via `requireRole('admin','office')` server actions; every portal page/file view logged to `portal_views`. All email touchpoints go through `src/lib/email.ts` which **no-ops with skip-logging until RESEND_API_KEY + EMAIL_FROM exist** — the owner flips that switch later; nothing in this plan changes that.

**Tech Stack:** Next.js 16, Supabase (Postgres RPCs + Storage), @react-pdf (DocShell/QrPosterPdf), `qrcode`, vitest.

**Conventions:**
- Migrations 0041–0043 are WRITTEN + COMMITTED here but applied by the OWNER pasting into the dashboard SQL editor (include `supabase_migrations.schema_migrations` bookkeeping rows in the paste, not in the migration files). Do not push code to main until they're applied.
- Portal styling: navy `#162040`, `PortalCard`, `rounded-xl`/`rounded-2xl`, `min-h-11` touch targets, slate text — copy classes from neighbouring portal components.
- Money NEVER appears in portal payloads (except the deliberate approvals/billing exceptions).
- Tests: `npx vitest run --maxWorkers=1`. Typecheck after every task. Live DB — test writes need `zz` prefix + cleanup.

**Key existing files (verified this session):**
- Request form: `src/app/portal/[token]/request/request-form.tsx` (+ `request/page.tsx`, `submitPortalRequest` in `portal/[token]/actions.ts`)
- RPC `portal_submit_request(p_token, p_site, p_title, p_description, p_urgency, p_photo_paths)` — `0029_portal_interactions.sql:321-372`; grants at `:731`
- Compliance tab item cards: `src/app/portal/[token]/sites/[siteId]/page.tsx:485-561` (item has `id, kind, title, issue_date, review_due, notes, has_file, filename`; `itemStatus` green/amber/red)
- Digest: `runDailyDigests` in `src/lib/notify.ts:430-563` (per-client items, `enabledLink.token` available, `renderEmail({listItems, cta})`)
- Upload guard to mirror: `src/app/portal/[token]/request-upload/route.ts` (images ≤10MB ≤5, path prefix `portal-requests/<linkId>/`)
- Link issuance: `src/lib/client-links.ts` `createClientLink` (crypto token, `${origin}/portal/${token}`); office UI `clients/[id]/portal-links.tsx`
- QR poster: `src/pdf/QrPosterPdf.tsx` (`kind: 'signon' | 'subbie_swms'` — POSTER_COPY map), QR generated in `src/app/api/pdf/[type]/[id]/route.tsx:~1609` via `QRCode.toDataURL(url, {width:600, margin:1})`
- Dashboard cards pattern: `src/app/(office)/dashboard-cards.tsx` (`DashboardCard`/`LoadError`/`Muted`/`MoreNote`, CARD_CHIP by title); loaders + `settle()` Promise.all in `src/app/(office)/page.tsx:~1117-1210`
- Office portal card: `PortalActivityCard` (`dashboard-cards.tsx:~1204`), fed by `loadPortalActivity`
- Site compliance office page: `src/app/(office)/clients/[id]/sites/[siteId]/page.tsx`
- PDF office routes: `src/app/api/pdf/[type]/[id]/route.tsx` (switch on `type`); portal watermarked route pattern: `src/app/portal/[token]/approval-pdf/[kind]/[id]/route.tsx`
- Portal resolve: `portal_resolve_link` (0026, extended 0028) returns client + company block; `portal_live_link` is the gate.

---

## Phase 1 — Renewal loop (due item → request → quote)

### Task 1: Migration 0041 — request↔compliance-item link + RPC v2

**Files:** Create `supabase/migrations/0041_renewal_requests.sql`

```sql
-- A portal work request can reference the compliance item that triggered it
-- (the "red light -> request re-inspection" loop).
alter table portal_requests
  add column compliance_item_id uuid references property_compliance_items(id);
create index portal_requests_compliance_item_idx
  on portal_requests (compliance_item_id) where compliance_item_id is not null;

-- Replace the submit RPC with an optional compliance-item param. The item
-- must belong to the same site (and therefore the same client as the link).
drop function portal_submit_request(text, uuid, text, text, text, text[]);
create function portal_submit_request(
  p_token text, p_site uuid, p_title text, p_description text,
  p_urgency text, p_photo_paths text[] default '{}',
  p_compliance_item uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_title text := left(trim(coalesce(p_title, '')), 200);
  v_desc text := trim(coalesce(p_description, ''));
  v_paths text[] := coalesce(p_photo_paths, '{}');
  v_prefix text;
  v_path text;
  v_number text;
  v_id uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if p_compliance_item is not null and not exists (
    select 1 from property_compliance_items
    where id = p_compliance_item and site_id = p_site
  ) then
    return null;
  end if;

  if v_title = '' or v_desc = '' or char_length(v_desc) > 4000
     or p_urgency not in ('low','normal','high','urgent')
     or coalesce(array_length(v_paths, 1), 0) > 5 then
    return jsonb_build_object('error', 'invalid');
  end if;

  v_prefix := 'portal-requests/' || l.id::text || '/';
  foreach v_path in array v_paths loop
    if v_path not like v_prefix || '%' or position('..' in v_path) > 0 then
      return jsonb_build_object('error', 'invalid');
    end if;
  end loop;

  if (select count(*) from portal_requests
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  v_number := 'REQ-' || lpad(next_number('portal_request')::text, 4, '0');

  insert into portal_requests
    (number, client_id, site_id, client_link_id, title, description,
     urgency, photo_paths, compliance_item_id)
  values (v_number, l.client_id, p_site, l.id, v_title, v_desc,
          p_urgency, v_paths, p_compliance_item)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'number', v_number, 'id', v_id);
end $$;
grant execute on function portal_submit_request(text, uuid, text, text, text, text[], uuid) to anon, authenticated;
```

Steps: write file → commit (`feat: portal requests can reference the compliance item that triggered them (schema)`). NOT applied yet.

### Task 2: Portal CTA + prefilled request form

**Files:** Modify `sites/[siteId]/page.tsx` (compliance card), `request/page.tsx`, `request/request-form.tsx`, `portal/[token]/actions.ts` (`submitPortalRequest`)

- Compliance item card: when `itemStatus !== 'green'`, render next to/below the download button:
  `<Link href={`/portal/${token}/request?site=${siteId}&item=${item.id}`} className="flex min-h-11 w-fit items-center gap-2 rounded-xl bg-[#162040] px-3.5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90">Request re-inspection</Link>` (with a `RefreshCwIcon`/`CalendarClockIcon`).
- `request/page.tsx`: read `searchParams.item` + `searchParams.site`; when both present, call the existing `portal_site_detail` RPC (same call shape as sites page — copy it) to find the item; pass `prefill={{ itemId, title: 'Re-inspection — {KIND_LABEL}: {item.title}', description: 'Our {KIND_LABEL} "{item.title}" is due for review on {fmtDate(review_due)}. Please arrange a re-inspection/renewal.', siteId }}` to `RequestForm`. Item not found → form renders normally.
- `RequestForm`: new optional `prefill` prop → seeds `title`/`description` state, locks `siteId`, keeps a small banner "Requesting renewal of: {item title}". Pass `complianceItemId` through `submitPortalRequest` → RPC arg `p_compliance_item`.
- `submitPortalRequest` action: add optional `complianceItemId` to its zod schema (uuid nullish) and pass to `.rpc('portal_submit_request', {..., p_compliance_item})`.

Steps: implement → typecheck → commit (`feat: portal 'Request re-inspection' CTA on due compliance items`).

### Task 3: Office visibility of renewal requests

**Files:** Modify `src/app/(office)/clients/requests/` register (find via Grep `portal_requests` in `(office)`)

- Register query: join `property_compliance_items(title, kind)` via `compliance_item_id`; detail drawer shows a "Renewal of: {kind label} — {title}" chip when set.
- Steps: implement → typecheck → commit (`feat: requests register shows the compliance item a renewal request came from`).

### Task 4: Digest email gains a renewal CTA (dormant-safe)

**Files:** Modify `src/lib/notify.ts`

- In `runDailyDigests` client loop, add a second CTA line: change `cta` to the existing portal link, and append to `listItems` a final line `'Tap any overdue item in your portal to request a re-inspection in one step.'` — OR (preferred if `renderEmail` supports a second cta) add `cta2: { label: 'Request a re-inspection', url: `${base}/portal/${enabledLink.token}` }`. Check `renderEmail`'s signature first; do whichever it supports without reshaping the template system.
- Steps: implement → typecheck → tests → commit (`feat: compliance digest points at the in-portal renewal flow`).

---

## Phase 2 — Dormancy radar

### Task 5: "Portal engagement" dashboard card

**Files:** Modify `src/app/(office)/page.tsx` (loader + wiring), `src/app/(office)/dashboard-cards.tsx` (card + chip)

Loader (money section — same gating as PortalActivityCard):

```ts
export interface PortalEngagementRow {
  clientId: string
  clientName: string
  lastViewed: string | null   // ISO or null = never
  daysSince: number | null
  overdueItems: number
}

async function loadPortalEngagement(supabase: Db, todayStr: string): Promise<PortalEngagementRow[]> {
  const [{ data: links }, { data: clients }] = await Promise.all([
    supabase
      .from('client_links')
      .select('id, client_id, revoked_at, expires_at')
      .is('revoked_at', null),
    supabase.from('clients').select('id, name').eq('archived', false),
  ])
  const now = new Date().toISOString()
  const live = (links ?? []).filter((l) => !l.expires_at || l.expires_at > now)
  const clientIds = [...new Set(live.map((l) => l.client_id as string))]
  if (clientIds.length === 0) return []

  const linkIds = live.map((l) => l.id as string)
  const [{ data: views }, { data: overdue }] = await Promise.all([
    supabase
      .from('portal_views')
      .select('client_link_id, viewed_at')
      .in('client_link_id', linkIds)
      .order('viewed_at', { ascending: false })
      .limit(2000),
    supabase
      .from('property_compliance_items')
      .select('id, sites!inner(client_id)')
      .eq('status', 'active')
      .not('review_due', 'is', null)
      .lt('review_due', todayStr),
  ])

  const lastByLink = new Map<string, string>()
  for (const v of views ?? []) {
    if (!lastByLink.has(v.client_link_id as string)) {
      lastByLink.set(v.client_link_id as string, v.viewed_at as string)
    }
  }
  const overdueByClient = new Map<string, number>()
  for (const o of overdue ?? []) {
    const cid = (o.sites as unknown as { client_id: string }).client_id
    overdueByClient.set(cid, (overdueByClient.get(cid) ?? 0) + 1)
  }

  const rows: PortalEngagementRow[] = clientIds.map((cid) => {
    const clientLinks = live.filter((l) => l.client_id === cid)
    const lasts = clientLinks
      .map((l) => lastByLink.get(l.id as string))
      .filter((x): x is string => Boolean(x))
      .sort()
    const lastViewed = lasts.at(-1) ?? null
    const daysSince = lastViewed
      ? Math.floor((Date.now() - new Date(lastViewed).getTime()) / 86_400_000)
      : null
    return {
      clientId: cid,
      clientName: (clients ?? []).find((c) => c.id === cid)?.name ?? 'Unknown client',
      lastViewed,
      daysSince,
      overdueItems: overdueByClient.get(cid) ?? 0,
    }
  })

  // Only surface stale clients (never viewed, or >30 days), worst first:
  // overdue-compliance clients top, then by staleness.
  return rows
    .filter((r) => r.daysSince === null || r.daysSince > 30)
    .sort(
      (a, b) =>
        b.overdueItems - a.overdueItems ||
        (b.daysSince ?? 9999) - (a.daysSince ?? 9999)
    )
}
```

Card: `PortalEngagementCard` titled `'Portal engagement'` (chip: `HeartHandshakeIcon` or `EyeOffIcon`, amber tint), rows: client name (link to `/clients/{id}`), right side `never viewed` / `{n}d ago` red when overdueItems>0 with `· {n} overdue`. Empty state: `Everyone with a live link has been in recently.`

Steps: implement → typecheck → commit (`feat: dashboard card flags portal-dormant clients with overdue compliance`).

---

## Phase 3 — Client document uploads (the register play)

### Task 6: Migration 0042 — portal_uploads + RPCs

**Files:** Create `supabase/migrations/0042_portal_uploads.sql`

```sql
-- Clients can file their own compliance documents (e.g. third-party
-- clearances) into the property register, pending office review. Storage
-- under attachments bucket prefix 'portal-uploads/<link id>/'.
create table portal_uploads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  client_link_id uuid not null references client_links(id),
  kind text not null check (kind in (
    'asbestos_register','asbestos_mgmt_plan','hazmat_survey',
    'clearance_certificate','air_monitoring','contaminated_land','other')),
  title text not null,
  issue_date date not null,
  review_due date,
  notes text,
  path text not null,
  filename text not null,
  content_type text,
  size bigint,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  compliance_item_id uuid references property_compliance_items(id),
  created_at timestamptz not null default now()
);
create index portal_uploads_site_idx on portal_uploads (site_id, status);
create index portal_uploads_client_idx on portal_uploads (client_id, created_at desc);

alter table portal_uploads enable row level security;
-- Office reads/writes; anon goes through RPCs only.
create policy portal_uploads_staff on portal_uploads
  for all to authenticated
  using (current_app_role() in ('admin','office'))
  with check (current_app_role() in ('admin','office'));

-- Client submits an upload (metadata; the file itself goes through the
-- guarded /portal/[token]/document-upload route first).
create function portal_submit_upload(
  p_token text, p_site uuid, p_kind text, p_title text,
  p_issue_date date, p_review_due date, p_path text, p_filename text,
  p_content_type text default null, p_size bigint default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l client_links;
  v_title text := left(trim(coalesce(p_title, '')), 200);
  v_prefix text;
  v_id uuid;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;

  if not exists (select 1 from sites where id = p_site and client_id = l.client_id) then
    return null;
  end if;

  if v_title = '' or p_issue_date is null
     or p_kind not in ('asbestos_register','asbestos_mgmt_plan','hazmat_survey',
                       'clearance_certificate','air_monitoring','contaminated_land','other') then
    return jsonb_build_object('error', 'invalid');
  end if;

  v_prefix := 'portal-uploads/' || l.id::text || '/';
  if p_path not like v_prefix || '%' or position('..' in p_path) > 0 then
    return jsonb_build_object('error', 'invalid');
  end if;

  if (select count(*) from portal_uploads
       where client_link_id = l.id
         and created_at > now() - interval '24 hours') >= 10 then
    return jsonb_build_object('error', 'rate_limited');
  end if;

  insert into portal_uploads
    (client_id, site_id, client_link_id, kind, title, issue_date, review_due,
     notes, path, filename, content_type, size)
  values (l.client_id, p_site, l.id, p_kind, v_title, p_issue_date, p_review_due,
          nullif(left(trim(coalesce(p_notes,'')), 2000), ''), p_path, p_filename,
          p_content_type, p_size)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function portal_submit_upload(text, uuid, text, text, date, date, text, text, text, bigint, text) to anon, authenticated;

-- The client's own uploads for a site (pending/rejected shown with status;
-- approved ones appear as real compliance items instead).
create function portal_my_uploads(p_token text, p_site uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l client_links;
begin
  l := portal_live_link(p_token);
  if l.id is null then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'kind', u.kind, 'title', u.title, 'status', u.status,
      'issue_date', u.issue_date, 'review_due', u.review_due,
      'review_note', u.review_note, 'created_at', u.created_at
    ) order by u.created_at desc)
    from portal_uploads u
    where u.client_id = l.client_id and u.site_id = p_site
      and u.status in ('pending','rejected')
  ), '[]'::jsonb);
end $$;
grant execute on function portal_my_uploads(text, uuid) to anon, authenticated;
```

Steps: write → commit (`feat: client compliance-document uploads pending office review (schema)`).

### Task 7: Guarded upload route

**Files:** Create `src/app/portal/[token]/document-upload/route.ts` — copy `request-upload/route.ts` structure, changes: ONE file per call, accept `application/pdf` + the image types, ≤10MB, storage prefix `portal-uploads/<link id>/`, reuse the same anon RPC `portal_register_upload`-style rate limiting if that's how request-upload does it (mirror exactly what it does — read it first).

Steps: implement → typecheck → commit (`feat: guarded portal document upload route`).

### Task 8: Portal "Add a document" UI

**Files:** Create `src/app/portal/[token]/sites/[siteId]/upload-document.tsx` (client component); modify `sites/[siteId]/page.tsx` (compliance tab).

- Compliance tab: after the items list, render `<UploadDocumentCard token siteId companyName />` plus the client's pending/rejected uploads (from `portal_my_uploads`, fetched server-side in the page) as cards with an "Awaiting review by {company}" amber chip or "Not added" red chip + `review_note`.
- Form fields: kind (select of the 7 kinds using `PROPERTY_COMPLIANCE_KIND_LABELS`), title, issue date, optional review due, optional notes, single file (pdf/image). Submit = upload file to `/portal/${token}/document-upload` → `submitPortalUpload` server action (new, in `portal/[token]/actions.ts`, calling the RPC). Success state: "Sent to {company} for review — it'll appear in your register once verified."
- Steps: implement → typecheck → commit (`feat: clients can file compliance documents for office review`).

### Task 9: Office review queue + notification hook

**Files:** Modify `src/app/(office)/clients/[id]/sites/[siteId]/page.tsx` (+ its client component for the compliance section — read it first); modify `src/lib/notify.ts` + `src/lib/email.ts` (new template `office_new_upload`); modify `PortalActivityCard` + `loadPortalActivity` (pending uploads count).

- Site page: "Client-submitted documents" section listing pending uploads (kind, title, dates, notes, download via signed URL). Actions (new server actions in a sensible existing actions file for that route):
  - `approvePortalUpload(uploadId)`: storage-copy `portal-uploads/...` → `property-compliance/<site>/<uuid>` (compliance evidence prefix — verify exact prefix used by office compliance upload first), insert `property_compliance_items` row (kind/title/issue_date/review_due/notes, evidence path, supersede handling identical to office-created items — reuse the existing create action's logic if one exists), set upload `approved` + `compliance_item_id`, `reviewed_by/at`.
  - `rejectPortalUpload(uploadId, note)`: status rejected + review_note.
- Notification: on client upload (in `submitPortalUpload` action) fire-and-forget `notifyOfficeNewUpload` (mirror `office_new_request` pattern — dormant until env keys).
- Dashboard: `loadPortalActivity` adds `pendingUploads` count; card shows "N documents awaiting review" line linking to `/clients`.
- Steps: implement → typecheck → commit (`feat: office review queue for client-submitted compliance documents`).

---

## Phase 4 — Compliance report PDF

### Task 10: ComplianceReportPdf + routes + buttons

**Files:** Create `src/pdf/ComplianceReportPdf.tsx`, `src/lib/build-compliance-report.ts` (data assembly, shared office/portal); modify `src/app/api/pdf/[type]/[id]/route.tsx` (new type `compliance-report`, id = clientId); create `src/app/portal/[token]/report-pdf/route.tsx`; buttons on office client page + portal landing.

- Data (per client): for each site — compliance items (kind label, title, issued, review due, status light), works history (completed jobs + closed projects w/ completion dates, titles — NO money), upcoming 90-day renewals list. Reuse `derivePropertyItemStatus`.
- PDF: DocShell-based, title "Property compliance report", period = generated date, per-site sections with an items table (Status / Document / Kind / Issued / Review due), summary header (X properties · Y current · Z due soon · W overdue), footer note "Prepared by {company}".
- Portal route: token-gated like `approval-pdf` (resolve link → build for `l.client_id` → watermark "Issued to {client} via the client portal — {date}" → log `portal_views` as `file:compliance-report`).
- Office route: admin/office, no watermark.
- Buttons: portal landing (`portal/[token]/page.tsx`) — "Download compliance report" near the summary cards; office client page — "Compliance report" button near the Portal card.
- Steps: implement → typecheck → tests (pure assembly fn if practical) → commit (`feat: one-click property compliance report PDF (office + watermarked portal)`).

---

## Phase 5 — Register QR poster

### Task 11: Migration 0043 — link scope

**Files:** Create `supabase/migrations/0043_register_links.sql`

```sql
-- Register-scope links: a per-site, compliance-only portal view suitable for
-- printing as an on-site "asbestos register" QR poster (register must be
-- readily accessible at the workplace).
alter table client_links
  add column scope text not null default 'full' check (scope in ('full','register')),
  add column site_id uuid references sites(id);
-- register links must pin a site
alter table client_links
  add constraint client_links_register_site check (scope <> 'register' or site_id is not null);
```

`portal_resolve_link` returns a jsonb — extend it to include `'scope', l.scope, 'site_id', l.site_id` (write the ALTERed function in full in the migration by copying its current definition from 0028 and adding the two keys — READ 0028's final definition first and reproduce it exactly plus the two fields).

Steps: write → commit (`feat: register-scope portal links (schema)`).

### Task 12: Scope gating + poster generation

**Files:** Modify `src/app/portal/[token]/page.tsx` (register scope → redirect to `/sites/{site_id}`), `sites/[siteId]/page.tsx` (register scope: only Compliance + Documents tabs; hide requests/messages/feedback/approvals banner; block other siteIds), `calendar/page.tsx` + `request/page.tsx` + `approvals/page.tsx` (register scope → redirect to the pinned site); modify `src/lib/client-links.ts` (`ensureRegisterLink(siteId)` create-or-reuse, no expiry, `notifications_enabled=false`, `show_financials=false`); `QrPosterPdf.tsx` (new kind `'register'`: headline "Asbestos register", corner "Site register", footer unchanged); office site page button "Register QR poster" → new pdf route type (follow the existing signon poster route in `api/pdf/[type]/[id]/route.tsx` — id = site id; route ensures the register link then renders poster with URL `${NEXT_PUBLIC_APP_URL}/portal/${token}`).

Steps: implement → typecheck → commit (`feat: per-site asbestos register QR poster backed by a compliance-only portal link`).

---

## Final verification

- [ ] `npx vitest run --maxWorkers=1` green; `npx tsc --noEmit` clean; `npm run lint` 0 errors
- [ ] Owner applies 0041+0042+0043 (single SQL paste incl. schema_migrations rows) — THEN push to main
- [ ] Preview click-through: renewal CTA → prefilled request (zz + clean or stop before submit), upload form (zz + reject + clean), dashboard engagement card, report PDF downloads (office + portal), register link renders compliance-only view, poster PDF renders
- [ ] Email touchpoints remain skip-logged (no env keys) — confirm `email_log` shows 'skipped' only

## Out of scope (deliberate)
- Per-person links/contact identity; custom domain; client logins — later.
- Turning notifications live — owner does this after telling clients.
