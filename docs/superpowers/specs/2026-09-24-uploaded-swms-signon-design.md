# Uploaded SWMS sign-on — design

Date: 2026-09-24
Status: approved in chat, pending spec review

## Problem

For most jobs the owner uploads a job-specific SWMS as a PDF into the job's
**Documents** section (e.g. `RJ26001-SWMS-01 Safe Work Method Statement.pdf`,
`attachments.kind = 'document'`, `parent_type = 'job'`). Those PDFs can't be
signed. Digital sign-on (field sign form, QR/share-link external sign-on,
re-sign on revision, sign-on register in the PDF) only exists for SWMS built
from portal templates (`swms_instances`).

## Goal

Workers sign on to an uploaded SWMS PDF from their phone. Logged-in staff and
external workers/subbies (QR / share link, no login) can both sign. The office
downloads one **signed copy**: the original PDF followed by a sign-on register
page.

## Approach

An uploaded PDF becomes a **document-backed `swms_instances` row**. It reuses
everything instances already have: the field list, the sign form, share links,
the QR poster, external signers, the version/re-sign compare-and-set,
revise/supersede and audit history. What's new:

1. The instance points at an attachment instead of carrying structured content.
2. The viewer pages show an **Open PDF** button instead of `SwmsFullView`.
3. The PDF route merges the original with a register page for document-backed
   instances.

Rejected: a separate document-sign-on system, which would duplicate the
tables, sign form and share-link logic. Also rejected: a register-only PDF
downloaded next to the original, which leaves two files to hand over.

## Data model (migration 0064)

- `swms_instances.document_attachment_id uuid null references attachments(id) on delete restrict`
  - Null means a template-built SWMS (unchanged behaviour). Set means a document-backed SWMS.
  - `on delete restrict`: a PDF in use by a SWMS can't be deleted from Documents. The
    attachment delete action surfaces a friendly error ("This file is the PDF for SWMS
    '<title>' — supersede that SWMS first").
- `template_id` is already nullable. Document-backed rows have `template_id = null`,
  `hazards = '[]'` and the structured columns null/default.
- `get_shared_doc` (latest definition in 0030): for a `signon` link whose SWMS
  instance has `document_attachment_id`, the `doc` payload adds
  `document: { path, bucket, filename }`. The RPC is security-definer and already
  validates the token (active, not expired). It only returns the path, never a URL.
- `submit_shared_signon` is unchanged. It already writes an external
  `swms_signatures` row pinned to the instance's current version.
- Update `supabase/fresh-install.sql` to match.

## Office: job page, SWMS section

`SwmsInstancesSection` / `AddSwmsDialog`:

- The dialog gets a source toggle: **From template** (existing) | **Uploaded PDF**.
- Uploaded PDF mode has:
  - **Title** (required; defaults to the chosen file's name without `.pdf`).
  - **File**: either **pick an existing job document** (PDF attachments on this
    job/project) or **upload a new PDF**. A new upload is stored as a normal
    `kind = 'document'` attachment on the parent first, so it also appears in
    Documents.
  - PDF only (`application/pdf`), size cap the same as existing document uploads.
- New server action `createDocumentSwmsInstance({ job_id | project_id, title, attachment_id })`:
  - `requireRole('admin','office','supervisor')`.
  - Verifies the attachment exists, is a PDF and belongs to the same parent.
  - Inserts an active instance at version 1.
- **Revise** on a document-backed instance opens a dialog asking for the
  replacement PDF (pick or upload, same picker). New action
  `reviseDocumentSwmsInstance(id, attachment_id)` switches
  `document_attachment_id` and bumps `version` in one update. Existing
  signatures become previous-version, so everyone re-signs. The old PDF stays in
  Documents. The audit trigger records the change, so history shows which file
  each version used.
- The card shows a **PDF** badge/filename. The existing **PDF** button becomes
  **Signed copy** for document-backed instances, pointing at the same
  `/api/pdf/swms/[id]` route. Share link / QR poster, supersede and history
  are unchanged.
- The same section is used on project pages, which get the same capability for free.

## Signing

**Logged in**: `/field/swms/[instanceId]`
- If `document_attachment_id` is set, render the title/version/parent header,
  an **Open PDF** button (a signed storage URL with a 1h expiry, created
  server-side with the user's client, opening in a new tab so the phone's native
  viewer handles it) and the prompt "Read the full SWMS before signing". Then
  the existing `SignForm`. `SwmsFullView` isn't rendered.
- `signSwms` is unchanged (same version compare-and-set).
- The `/field/swms` list includes document-backed instances unchanged. Check
  that the query doesn't filter on `template_id`.

**External**: `/sign/[token]`
- When `doc.document` is present, the server component creates a 1h signed URL
  with the service-role client. This is only reached after `get_shared_doc`
  has validated the token. It renders **Open PDF** in place of `SwmsFullView`,
  then the existing `SignClient` (name, company, signature).
- The service-role client is used only to sign that one path returned by the
  RPC. No other data is read with it.

**Storage read access for field users**: verify during planning that
`field`-role users can sign URLs for job document attachments under the
current storage RLS (migrations 0015/0019). If they can't, the field page
creates the URL server-side with the service-role client after confirming
(through the user's own RLS-scoped query) that they can read the instance.

## Signed copy (PDF route)

In `swmsPdf(id)` in `src/app/api/pdf/[type]/[id]/route.tsx`, for document-backed instances:

1. Load the instance, current-version signatures and the earlier-version count
   using the existing queries.
2. Render a **register-only** react-pdf document. Factor the existing
   `SignatureTable` in `SwmsPdf.tsx` into a small `SwmsRegisterPdf`, a header
   (company, SWMS title, vN, job/project, source filename, "generated
   <date>"), and the register table with name, company/role, signed at and
   signature image.
3. Download the original PDF bytes from storage. Use `pdf-lib` (new
   dependency) to load the original, copy in the register pages and save. The
   response is `inline; filename="<title>-v<N>-signed.pdf"`.
4. **Fallback**: if the original is encrypted or can't be parsed, return the
   register-only PDF with a banner line: "Original PDF could not be attached
   (<reason>) — download it separately from Documents."
5. Always generated on demand. The stored original is never modified.

Template-built instances keep the current `SwmsPdf` output unchanged.

## Error handling

- Creating with a non-PDF, or an attachment from another parent, is rejected
  with a clear message.
- Signing a superseded instance, or a version revised mid-read: existing messages.
- An expired or deactivated share link: the existing message.
- A missing storage object for Open PDF shows "The SWMS file is unavailable —
  contact the office", and the sign form is still shown. Signed copy uses the
  register-only fallback.
- A document in use can't be deleted from Documents (see above).

## Testing

- Unit tests (vitest, in the style of `tests/swms.test.ts`):
  - the create action's validation (PDF-only, same-parent);
  - revise switching the file and bumping the version;
  - the merge helper: a valid PDF gives original pages plus register pages, and
    an encrypted or garbage PDF gives the register-only fallback.
- Migration: `get_shared_doc` returns `document` for document-backed
  instances and omits it otherwise; the delete-restrict FK blocks deleting an
  in-use attachment.
- Manual/live proof after deploy, using a zz-prefixed test job:
  1. Create an uploaded SWMS from an existing document.
  2. Sign as a logged-in user on a mobile viewport.
  3. Sign externally through the share link.
  4. Download the signed copy and confirm the original pages come first, then
     the register with both signatures.
  5. Revise with a new PDF and confirm re-sign is required.
  6. Clean up the test data.

## Out of scope

- Stamping signatures onto the SWMS's own pages or signature blocks.
- Non-PDF uploads (Word, images).
- An in-page PDF renderer. The phone's native viewer is used.
- Converting uploaded PDFs into structured template SWMS.
