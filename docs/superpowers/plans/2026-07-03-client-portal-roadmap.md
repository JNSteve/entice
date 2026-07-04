# Client Portal Roadmap — Entice (v2, property-compliance-first)

> Rewritten 2026-07-03 after owner direction. The portal is anchored on the
> PROPERTY, not the project, and is a business/client product — it is not part
> of the ISO certification path and is not sequenced behind it.
> Owner sign-off pending on the decisions in §6.

## 1. Who it is for

Property owners, property managers, real estate agencies, facility managers —
anyone responsible for industrial or commercial property who must stay across
compliance and track works on their buildings. These people carry their own
statutory duties (asbestos registers and asbestos management plans for
pre-2004 commercial buildings, register currency after any removal work,
clearance evidence before reoccupation) and they commission works repeatedly.

The portal makes ECR the place their property compliance *lives*. That is a
retention product, not a reporting feature: a property manager whose asbestos
registers, clearance certificates and works history for twelve buildings sit
in ECR's portal does not go to tender for the next job.

## 2. The core concept

One secure link per client organisation (no login in v1). It opens on a
**property list** — every site of theirs ECR serves — each with a compliance
traffic light. Drill into a property:

- **Compliance tab** — the property's compliance register: asbestos register,
  asbestos management plan, HAZMAT survey, clearance certificates, air
  monitoring results, contaminated-land documents. Each item carries issue
  date, review/expiry date and a traffic light (current / due soon / overdue),
  with the controlled document behind it.
- **Works tab** — live jobs/projects on that property (status, stage, curated
  photos, key dates) and the full works history with closeout documents.
- **Requests** — raise a new work request against the property (becomes a
  lead/quote inside Entice).

## 3. Foundation already built (reuse, don't invent)

| Existing Entice mechanism | Portal use |
|---|---|
| `sites` (already linked to clients, jobs, projects, quotes) | The property anchor — sites become first-class "properties" |
| `share_links` token pattern (`/sign/[token]`, `/submit/[token]`) | Client-org portal links: anonymous, scoped, revocable, no passwords |
| `deriveComplianceStatus` + ComplianceLight (vendors, tickets) | Property compliance traffic lights — same 30-day amber rule |
| `documents` register + storage signed URLs | The controlled documents behind each compliance item |
| `attachments` + curated-share flags | Photos and works evidence, shared only when toggled |
| `audit_log` append-only triggers | Every client view/download/approval is a timestamped record |
| Signature capture (form sign-ons, SWMS) | Variation/quote acceptance in CP2 |
| Quotes pipeline | Work requests land as quote leads |
| Objectives KPI engine | Portal feedback → customer-satisfaction KPI auto-source |

## 4. Phased roadmap

### CP1 — Property compliance window (size L)
The heart of the product; build first.
- **Schema:** `property_compliance_items` (site_id, kind: asbestos_register |
  asbestos_mgmt_plan | hazmat_survey | clearance_certificate | air_monitoring
  | contaminated_land | custom; title, issue_date, review_due, document/
  attachment link, status, notes) with the standard audit trigger. `client_links`
  (client_id, token, expiry, revoked_at) cloned from `share_links`.
- **Office side:** a "Compliance" tab on each site/property (admin/office
  manage items; expiry lights in the office UI too — ECR gets the recall
  reminder business: "your register re-inspection is due"), plus a "Portal"
  section per client to issue/revoke links and see the access log.
- **Client side:** `(portal)` route group — property list with traffic
  lights → property detail with Compliance + Works history tabs. Read-only,
  branded, watermarked PDFs, everything logged.
- Works tab v1 = list of jobs/projects on the site with status + shared
  documents/photos (curation toggles on attachments).

### CP2 — Live works + approvals (size M)
- Live works tracking: stage/% from programme, curated photo stream, claim
  and invoice history per property.
- **Variation and quote acceptance** with on-screen signature (name +
  signature + timestamp + IP → audit_log; flips variation/quote status).
- **Work requests**: client raises a request against a property → appears in
  Entice as a lead with notification; office converts to quote.
- Comment thread per property (shared machinery with the future RFI register
  — build once).

### CP3 — Compliance calendar + notifications + handover (size M)
- Email notifications: compliance item due in 30 days / overdue; new document
  published; work request updates; clearance issued.
- Compliance calendar view across a client's whole portfolio.
- **Closeout/handover pack** per completed job: one generated dossier
  (clearances, air monitoring, waste dockets, warranties, final claim).
- Feedback widget on job completion → auto-feeds the "Customer satisfaction
  ≥4.5/5" objective KPI.

### Later / only if pulled
Client logins (magic email links) for large portfolio managers, client
document upload, white-labelling for real-estate agencies, payment status.

## 5. Sequencing

The portal is a commercial product decision, sequenced on business value —
not behind the ISO roadmap. Options:
- **Portal-first:** CP1 next. Strongest client-facing move; asbestos-register
  content for CP1 exists already (documents + attachments).
- **Evidence-first:** ISO Phase 4 (ITP/lots + environmental/waste) before CP2/
  CP3 — those modules generate richer works evidence for the portal to show.
- CP2's comment thread and the T&M/RFI/defects batch share machinery —
  whichever is built first should build it for both.

## 6. Owner decisions before build

1. **Link-based (recommended) vs client logins** — links per client org with
   expiry + revoke; upgrade path to logins later.
2. **Default sharing** — recommend nothing visible unless explicitly toggled
   per item/photo/document.
3. **Compliance item kinds** — confirm the starter list in CP1 covers what
   property managers ask ECR for (add/remove kinds).
4. **Variation acceptance wording** — check against ECR contract terms
   (portal acceptance = contractual acceptance, or evidence of it?).
5. **Watermarking** shared PDFs ("Issued to {client} {date}") — recommend on.
6. **GSS boundary** — if assessor reports authored by GSS appear in the
   portal, confirm how they are labelled so the ECR/GSS impartiality control
   (SMS-15) stays clean.
7. **Who publishes** — recommend admin/office only.
