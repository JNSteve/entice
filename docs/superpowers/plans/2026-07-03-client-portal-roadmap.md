# Client Portal Roadmap — Entice

> Refreshed 2026-07-03. Replaces the v1 placeholder ("client portal — not yet done").
> Owner sign-off pending on the decisions in §5.

## 1. Who it is for and what it must do

ECR's clients are insurers and loss adjusters, commercial venue owners, schools,
government bodies and strata managers. Work is often asbestos remediation in
occupied premises. What these clients repeatedly ask for:

- **Where is the job up to?** (status, programme, photos — without phoning)
- **The compliance evidence.** Clearance certificates, air monitoring results,
  licences and insurances — insurers will not release payment and venues will
  not reoccupy without them.
- **Approvals.** Variations and quotes signed off quickly, in writing.
- **The paper trail.** Claims and invoices with supporting evidence.
- **The handover pack** at completion — one dossier, not forty emails.

A portal converts those from inbound phone calls into self-service, and every
client view/download becomes a timestamped record (ISO 9001 8.2.1 customer
communication evidence, and dispute armour).

## 2. Foundation already built (reuse, don't invent)

| Existing Entice mechanism | Portal use |
|---|---|
| `share_links` token access (`/sign/[token]`, `/submit/[token]`) — anonymous, RLS-scoped, revocable | The entire portal auth model: per-client, per-project secure links. No client passwords in v1. |
| Base64 signature capture (form sign-ons, SWMS) | Variation / quote acceptance signatures |
| `audit_log` append-only triggers | Immutable record of what the client saw, approved, downloaded, and when |
| PDF infra (DocShell + per-type routes) | Client-facing claim/variation/handover documents |
| `attachments` + storage signed URLs | Curated document/photo sharing |
| Claims, variations, quotes modules | The content being shared/approved |
| Objectives KPI engine (`customer satisfaction` is currently manual) | Portal feedback widget becomes the auto data source |

## 3. Phased roadmap

### CP1 — Read-only project window (size M)
A client opens a secure link (no login) and sees a branded, curated view of one
project/job:
- Status header: stage, % complete (from programme), key dates, site contact.
- **Shared documents** — only items explicitly marked "share to client"
  (clearances, air monitoring, insurances, SWMS on request). Nothing is shared
  by default.
- Progress photo gallery (curated flag per photo).
- Claim/invoice history (issued documents only).
- Every view and download logged to `audit_log`.

Mechanics: `client_links` table (token, client_id, project/job scope,
expiry, revoked_at) cloned from `share_links`; a public `(portal)` route group
server-rendering read-only components; "Share to client" toggles on
attachments/documents; office-side "Portal" tab per project to manage the link
and see the access log.

### CP2 — Approvals and communication (size M)
- **Variation approval**: client opens the variation PDF view, accepts or
  queries, signs on screen (name + signature + timestamp + IP recorded).
  Approval flips variation status and is audit-logged. Same flow reused for
  quote acceptance.
- **Comment thread** per project (client ↔ office), emailed notifications —
  the seed of the RFI/correspondence register (shared machinery; build once).
- Client-safe **weekly progress summary** (auto-compiled from diary/programme,
  office reviews before it publishes).

### CP3 — Handover pack + client dashboard (size M)
- **Closeout dossier**: one generated PDF/zip — clearance certificates, air
  monitoring, waste tracking dockets, ITP/lot records (Phase 4), warranties,
  final claim — assembled from tagged records; permanent archive link.
- **Multi-project view** for repeat clients (a loss adjuster with four claims
  running sees all four behind one link).
- **Feedback widget** (1–5 + comment) on completion → auto-feeds the
  "Customer satisfaction ≥4.5/5" objective KPI (replaces manual entry).

### Later / only if pulled
Real client accounts (magic-link email login), push notifications, client-side
document upload, payment integration.

## 4. Sequencing against the ISO roadmap

The portal is **not** on the certification critical path. Recommended slot:
after ISO Phase 4 items that generate the evidence clients want (ITP/lot
conformance, environmental/waste records make CP1/CP3 much richer), and it
pairs naturally with the T&M-tickets + RFI + defects batch — CP2's comment
thread and the RFI register should be one build, not two.

Suggested order: **Phase 4 (ITP + environmental) → T&M/RFI/defects batch →
CP1+CP2 → Phase 5 go-live hardening → CP3.**
A standalone CP1 can be pulled forward any time a specific client asks — it is
independent and ~a week of build.

## 5. Owner decisions before build

1. **Link-based (recommended) vs client logins** — links are zero-friction and
   match how insurers work; logins add support burden. Recommend links with
   expiry + revoke, upgrade path to logins later.
2. **Default sharing** — recommend nothing shared unless explicitly toggled
   per item. The alternative (share-by-default with exclusions) risks leaking
   internal records.
3. **Variation acceptance wording** — the on-screen acceptance text should be
   checked against ECR's contract terms (is portal acceptance the contractual
   acceptance, or evidence of it?).
4. **Watermarking** shared PDFs ("Issued to {client} {date}") — recommended on.
5. **Who can publish** — recommend admin/office only; supervisors can flag
   items as "suggest sharing".
