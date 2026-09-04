# Client portal — works-first upgrade

**Date:** 2026-09-04 · **Status:** Implemented on `feat/portal-works-first` (2026-09-04); awaiting migration 0062 on the live DB, then merge + deploy · **Module:** Client portal (`/portal/[token]`) + office sharing surfaces

## 1. Why

The portal is built and deployed (CP1–CP3, retention upgrades, invoices,
maintenance log) but has never been used with a real client. The first real
clients are builders and contractors (Damon Constructions, Malcolm Civil,
Hamilton, SAS Property Managers). For them the portal must open on **their
quotes, jobs, photos and close-out packs**, not on a property-compliance
register they do not keep. Three things block that today:

1. **The landing page punishes works-only clients.** A property with zero
   compliance items renders a red "attention required" ring and counts as
   overdue. Every real client would open on red warnings.
2. **Nothing is shared by default and there is no quick way to share.**
   Quotes need a manual *Publish to portal* click while status is `sent`
   (all three real accepted quotes were never published, and an accepted
   quote without a portal acceptance row appears nowhere). Photos and
   documents need a per-item eye toggle. Project diary photos cannot be
   shared at all.
3. **No way to deliver the link.** Office copies the URL by hand. Email is
   wired but still skip-logs because `RESEND_API_KEY` / `EMAIL_FROM` were never
   added to Vercel.

This is an **upgrade of the existing portal**, not a rebuild. Token links,
SECURITY DEFINER RPCs gated by `portal_live_link`, `portal_views` logging,
requests, messages, uploads, compliance register, register-scope QR links,
maintenance, billing, calendar and the email engine are all kept as they are.

## 2. Owner decisions (2026-09-04)

| Decision | Choice |
|---|---|
| First clients / landing | Builders and contractors, **works-first**. Compliance stays available, never dominates, never shows red for a missing register. |
| Sharing model | **Per-work share switch** on each job and project. Sent quotes publish automatically. Office can still hide single items. |
| Link delivery | **Invite email from the app plus copy.** Uses the existing engine; skip-logs until the owner adds the Resend env vars. |

## 3. Portal experience

### 3.1 Navigation and shell

`PortalShell` nav (full-scope links only) becomes five items, horizontally
scrollable on narrow screens, `min-h-11` targets, same active styling:

| Item | Route | Notes |
|---|---|---|
| Overview | `/portal/[token]` | replaces "Properties" as the landing |
| Works | `/portal/[token]/works` | new |
| Quotes | `/portal/[token]/approvals` | existing page, renamed in nav; title "Quotes & approvals" |
| Properties | `/portal/[token]/properties` | new route holding today's property list |
| Calendar | `/portal/[token]/calendar` | unchanged |

`active` prop widens to `'overview' | 'works' | 'quotes' | 'properties' | 'calendar'`.
Register-scope links keep their single-property register view and never see
the nav. Every new page logs through `portal_log_view` like the others.

### 3.2 Overview (landing)

Order, top to bottom:

1. Welcome header (unchanged copy) + *Compliance report (PDF)* button **only
   when the client has at least one compliance item**.
2. Approvals banner (unchanged) when anything awaits signature.
3. Four summary cards: **Active works** · **Quotes awaiting approval** ·
   **Open requests** · fourth card is **Compliance** (current / due soon /
   needs attention, as today) when the client has ≥1 compliance item,
   otherwise **Properties** (count).
4. **Current works** — cards for every live job/project across all
   properties (and works with no site), each linking to its work page
   (§3.4). Empty state: "No works under way right now."
5. **Your quotes** — up to three pending approvals, then a link to the
   Quotes page. Hidden when nothing is pending.
6. **Your properties** — compact property rows (ring + name + address +
   open works count), linking to the property page. "Request work" button
   stays in this section header.
7. **Your requests** — unchanged.

### 3.3 Property status without a register

New pure helper in `src/lib/portal.ts`:

```ts
export type PortalPropertyStatus = ComplianceStatus | 'none'
export function derivePortalPropertyStatus(dues, today): PortalPropertyStatus
// [] → 'none'; otherwise derivePropertyStatus(dues, today)
```

`derivePropertyStatus` is **unchanged** (office recall business keeps "no
register = red"). The portal uses the new helper everywhere it draws a ring
or light: `StatusRing` and `PortalLight` accept `'none'` (slate ring,
`BuildingIcon`, label "No compliance register on file"), `propertyStatusPhrase`
returns `{ status: 'none', phrase: 'No compliance register on file' }`, and
`summarisePortfolio` stops counting zero-item sites as overdue (it already
tracks them as `untracked`). The site page header and calendar use the same
helper. The compliance report PDF is unaffected (it only lists items).

### 3.4 Work page — `/portal/[token]/works/[kind]/[id]`

`kind` ∈ `job | project`, `id` UUID-validated. Fed by a new RPC
`portal_work_detail(p_token, p_kind, p_id)` (§5.3); null → `notFound()`.

Content:

- Back link (to Works), number, title, property name + address (or "No
  property recorded"), `WorkStatusBadge`.
- **Status timeline** (new `WorkTimeline` in `portal-ui.tsx`, same visual
  language as `RequestTimeline`):
  - job: Quoted → Scheduled → In progress → Completed. `invoiced`/`paid`
    map to Completed; `lost` never reaches the portal.
  - project: Active → Practical completion → Defects liability → Closed.
- Dates row (scheduled start/end or start/PC date), `ProgressBar` for
  projects with programme progress.
- **Quote** row when the work's `quote_id` is a published quote: number,
  decided state, link to the approval page / PDF.
- **Photos** gallery (existing `PhotoGallery`), **Documents** rows
  (existing `DocRows`), **Close-out pack** button (existing handover
  caption rule) — all from `client_visible` attachments only.
- **Feedback card** when the work is in the history group and no rating
  exists (existing `FeedbackCard`).
- "Message us about this work" → property Messages tab (hidden when the
  work has no site).

### 3.5 Works page — `/portal/[token]/works`

Lists all works for the client from `portal_works(p_token)` (§5.3), split
into **Current** and **Completed** (same `workGroupForJob/Project` rules),
each card → work page. Cards show number, title, property, status badge,
dates, photo count and a "Close-out pack" chip when one is visible.

### 3.6 Property page changes

- Works tab cards link to the work page instead of expanding inline; the
  inline gallery/doc rows stay as a preview (first 6 photos).
- Header ring/light use §3.3.
- The Compliance tab's empty state for a works-only client reads "No
  compliance register is kept for this property. Ask us if you would like
  one set up." (no red).

### 3.7 Quotes page

The existing approvals page gains a third group, **Decided**, for quotes and
variations decided **outside** the portal (§5.2), rendered like "Signed
through the portal" but worded "Accepted on {date}" / "Declined on {date}"
without a signer. The approval detail page shows these read-only with the
PDF link (no sign block).

## 4. Sharing model

### 4.1 Per-work switch

New columns `jobs.client_shared boolean not null default false` and
`projects.client_shared boolean not null default false`.

Server action `setWorkClientShared(kind, id, shared)` (admin/office) in a new
`src/lib/work-sharing.ts`:

- `shared = true`: set `client_shared = true`, then
  `update attachments set client_visible = true where parent matches and kind in ('photo','document','pdf')`
  for the work itself and, for projects, for `parent_type = 'diary'` rows
  whose diary belongs to the project. **Dockets never share.**
- `shared = false`: set `client_shared = false` and `client_visible = false`
  on the same set (including the handover pack).
- Returns counts so the toast can say "Shared 14 photos and 3 documents".

New uploads (`recordAttachment`, field photo capture, `generateHandoverPack`)
default `client_visible` to the parent work's `client_shared` for kinds
photo/document/pdf; dockets stay false. For `parent_type = 'diary'` the
parent work is the diary's project. The per-item eye toggle is unchanged and
still wins after the switch has run.

### 4.2 Office UI

- `ShareWithClientSwitch` (client component): label "Share with client",
  helper "Photos, documents and the close-out pack appear in {client}'s
  portal. Dockets never do." Placed in the job page action row next to
  `StatusActions`, and in the project layout header next to
  `ProjectStatusSelect`. Confirms before turning **off** ("Hide everything
  from the client portal?").
- The office diary list (`projects/[id]/diary/diary-list.tsx`) passes
  `canCurate` so diary photos get the same eye toggle.
- "Portal" column (Shared / Not shared chip) on the client page Jobs and
  Projects tables and on the site page "Works on this property" table.

### 4.3 Quotes publish automatically

- `setQuoteStatus` draft→sent also sets `portal_published = true`. The
  existing Publish/Unpublish button remains as the opt-out; its copy changes
  to "On the client portal — {client} can view the PDF and sign online"
  with **Unpublish**.
- Migration backfill: `update quotes set portal_published = true where status in ('sent','accepted')`.
- `canPublishQuote` widens to `sent | accepted` so office can re-publish an
  accepted quote it unpublished earlier.

## 5. Data and RPC changes — migration `0062_portal_works_first.sql`

Applied by the owner pasting into the Supabase SQL editor (this session has
no DDL path); include the `supabase_migrations.schema_migrations` row in the
paste, not in the file.

### 5.1 Columns

`jobs.client_shared`, `projects.client_shared` (above), plus quote backfill.

### 5.2 `portal_approvals` (replace)

- `decided` now also includes published items whose status is a terminal
  non-portal decision and which have **no** `portal_acceptances` row:
  quotes `accepted` → `action = 'accepted'`, `lost` → `'declined'`;
  variations `approved` / `rejected` likewise. `signer_name` null,
  `signed_on` = `decided_at` (both tables have it), Brisbane date. A new `source: 'portal' | 'office'` field
  on decided items.
- `portal_approval_file` widens quote statuses to `('sent','accepted','lost')`
  and variations to `('submitted','approved','rejected')` so decided items
  keep their PDF.

### 5.3 New RPCs

`portal_works(p_token) returns jsonb` — array over the client's jobs
(`status not in ('quote','lost')`, not archived) and projects (not archived),
site optional:

```
{ kind, id, number, title, status, site_id, site_name,
  from, to, progress_pct, photo_count, doc_count, has_handover,
  quote_id, quote_number }
```

Counts and `has_handover` only consider `client_visible` attachments
(`has_handover` = a visible non-photo attachment with the handover caption).

`portal_work_detail(p_token, p_kind, p_id) returns jsonb` — null unless the
work belongs to the link's client (and, for register-scope links, always
null). Returns the same header fields plus `description`, the full visible
attachment list (`id, filename, kind, content_type, caption, size,
created_at`), and `quote: { id, number, status, decided }` when the linked
quote is published.

`portal_site_detail` (replace): project attachments also include
`client_visible` rows with `parent_type = 'diary'` joined through
`diaries.project_id`. `portal_file_path` (the download gate) accepts the
same diary parent so those photos download through the logged route.

`portal_log_view` is reused; no change.

All new functions: `security definer`, `set search_path = public`, `stable`
where read-only, `grant execute … to anon, authenticated`, null for dead
tokens, and `p_site`-style ownership checks against `l.client_id`.

## 6. Invite email

### 6.1 Action

`sendClientLinkInvite({ linkId, clientId, contactId, note, origin })` in
`src/lib/client-links.ts` (admin/office): validates the link is active and
belongs to the client and the contact belongs to the client and has an
email; sends via `sendEmail` with new template `client_portal_invite`
(add to `EMAIL_TEMPLATE_LABELS`: "Client — portal invite"). Returns
`{ status: 'sent' | 'skipped' | 'failed', to }`.

Email body (`renderEmail`): heading "Your {company} client portal",
intro "{company} has set up a secure online portal for {client}. Use it to
review and sign quotes, follow works in progress, view photos and close-out
reports, and request new work.", optional note paragraph, CTA "Open your
portal" → `{origin}/portal/{token}`, footer line "Keep this link private —
anyone with it can view your portal."

### 6.2 Office UI

- Issue-link dialog: after issuing, a second step "Send invite" with a
  contact select (contacts with email; disabled with hint when none),
  optional note textarea, **Send invite** and **Copy invite message**
  buttons. Copy produces:
  `"{company} has set up a secure client portal for {client}. Open it here: {url}. Please keep this link private."`
- Link table: a **Send** (mail icon) action on active links opening the
  same step.
- Result toasts: sent → "Invite emailed to {to}"; skipped → "Invite logged
  but not sent — email sending isn't configured yet (Settings → Email)";
  failed → error.

### 6.3 Quote-sent email

`notifyClientQuoteSent(quoteId)` in `src/lib/notify.ts`, fired with
`after()` from `setQuoteStatus` when a quote goes draft→sent (and therefore
publishes). Template `client_quote_sent` ("Client — quote ready to sign").
Recipient `primaryContactEmail`, CTA to
`/portal/{token}/approvals/quote/{id}` via `pickLiveLink`; no live link →
CTA omitted, email still goes with the number and title. Dormant-safe like
every other notification.

## 7. Office-side summary

| Surface | Change |
|---|---|
| Job page | Share switch in the action row |
| Project layout header | Share switch beside status |
| Project diary (office) | Eye toggle on diary photos |
| Client page | Portal column on Jobs/Projects; invite step in link dialog; Send action on links |
| Site page | Portal column on works table |
| Quote builder | Auto-publish copy; button becomes Unpublish/Publish for sent **and** accepted |
| Settings → Email | New templates appear in the log automatically |

## 8. Out of scope

Client logins, white-labelling, per-contact links, notifications for
share/unshare events, changes to the daily digest, regulated-waste or
maintenance surfaces, the compliance report PDF, and any RLS changes
(anon never gets table access; the RPC pattern holds).

## 9. Testing and verification

- **Vitest (pure):** `derivePortalPropertyStatus`, `propertyStatusPhrase`
  none-state, `summarisePortfolio` untracked handling, `WorkTimeline` index
  mapping for every job/project status, `canPublishQuote` widening, invite
  message text.
- **RPC boundary proofs (live DB, zz-prefixed, cleaned up):** `portal_works`
  hides unshared attachments' counts and quote-status jobs; `portal_work_detail`
  returns null for another client's work and for register-scope links;
  `portal_approvals` shows an office-accepted published quote in `decided`;
  diary photos appear only when visible.
- **Live HTTP loads** of Overview, Works, a work page, Quotes, Properties,
  Calendar, a property page with `?tab=` for every tab, after deploy.
- **Click-level checks** (per project rule): share switch on/off with
  counts, invite dialog send + copy, quote publish/unpublish, diary eye
  toggle.
- Typecheck, lint, full `npx vitest run --maxWorkers=1` before each commit.
- README: replace the stale "Client portal (read-only claim/variation
  visibility)" future-ideas line with a "Client portal" section describing
  the works-first portal, sharing switch, quotes and invites.

## 10. Rollout

1. Code lands on `main` but is **not deployed** until the migration is in:
   without the new columns and RPCs the share switch and new pages would
   error.
2. Owner pastes migration 0062 into the SQL editor.
3. Deploy; run the live HTTP + click checks.
4. Owner adds `RESEND_API_KEY` + `EMAIL_FROM` to Vercel (and
   `NEXT_PUBLIC_APP_URL` if unset) to switch email on — no code change.
5. Owner issues a link for one real client, shares one job, sends the
   invite.
