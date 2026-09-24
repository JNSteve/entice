# Uploaded SWMS Sign-on Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workers (logged in, or external through a QR/share link) sign on to a SWMS that was uploaded as a PDF to a job or project. The office downloads a "signed copy": the original PDF followed by the sign-on register.

**Architecture:** An uploaded PDF becomes a document-backed `swms_instances` row (new nullable FK `document_attachment_id` → `attachments`). The instance reuses all existing SWMS machinery (sign form, share links, QR poster, versioning, revise/supersede, audit). The viewer pages show an **Open PDF** link instead of the structured view. `/api/pdf/swms/[id]` renders a register-only react-pdf document and appends it to the original with `pdf-lib`. External viewers get the PDF through a narrow anon storage-read policy gated on a live share link, so no service-role key is needed.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres RLS, storage), @react-pdf/renderer, pdf-lib (new), vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-uploaded-swms-signon-design.md`

## Global Constraints

- Work on branch `feat/uploaded-swms-signon` (create it from `main`). Don't commit feature code to `main`.
- This is NOT the Next.js you know. Before using any Next API that isn't already used in the file you're editing, read the relevant guide in `node_modules/next/dist/docs/`.
- npm on this machine needs the Norton CA: prefix installs with `NODE_EXTRA_CA_CERTS='C:\Users\nickj\norton-ssl-root-ca.pem'` (in Bash: `NODE_EXTRA_CA_CERTS=/c/Users/nickj/norton-ssl-root-ca.pem npm install …`).
- Next 16 JSX drops the space after `{expr}` at the end of a line. Use `{' '}` explicitly where a space matters.
- PDF-only uploads for SWMS (`application/pdf` or a `.pdf` filename). Upload size cap is the existing `MAX_UPLOAD_SIZE` (25 MB) from `src/lib/storage-keys.ts`.
- Signed storage URLs expire after 3600 seconds (1h).
- The stored original PDF is never modified. The signed copy is generated on demand.
- Template-built SWMS behaviour and output must stay exactly as they are.
- Production DB: migrations are applied by the owner pasting SQL into the Supabase dashboard. Code that selects `document_attachment_id` must NOT be deployed before migration 0064 is applied.
- Run react-pdf tests with `--maxWorkers=1` (they flake in parallel on this machine).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0064_uploaded_swms.sql` (create) | Column + FK, `get_shared_doc` returns `document`, anon storage policy for live shared SWMS PDFs |
| `supabase/fresh-install.sql` (modify) | Append 0064 |
| `src/lib/pdf-merge.ts` (create) | `checkOriginalPdf`, `appendPdf` (pdf-lib) |
| `src/lib/swms-document.ts` (create) | Zod schemas + pure checks for document-backed SWMS |
| `src/lib/swms-actions.ts` (modify) | `createDocumentSwmsInstance`, `reviseDocumentSwmsInstance`; template revise refuses document-backed |
| `src/lib/attachments.ts` (modify) | Friendly error when deleting a PDF in use by a SWMS |
| `src/lib/swms-queries.ts` (modify) | `document` on list rows; `fetchSwmsDocumentOptions` |
| `src/lib/upload-attachment-client.ts` (create) | Browser-side upload + `recordAttachment` returning the new id |
| `src/components/SwmsDocumentForms.tsx` (create) | PDF picker/uploader, add-from-PDF form, revise-with-PDF dialog |
| `src/components/SwmsInstancesSection.tsx` (modify) | Source toggle, PDF badge, Signed copy label, doc revise |
| `src/components/SwmsDocumentLink.tsx` (create) | "Open PDF" block shared by the field and public pages |
| `src/app/(office)/jobs/[id]/page.tsx`, `src/app/(office)/projects/[id]/whs/page.tsx` (modify) | Pass document options |
| `src/app/field/swms/[instanceId]/page.tsx` (modify) | Open PDF for document-backed instances |
| `src/app/sign/[token]/page.tsx` (modify) | Open PDF for document-backed shared SWMS |
| `src/pdf/SwmsPdf.tsx` (modify) | Export building blocks, extract `ChangeRecordTable` |
| `src/pdf/SwmsRegisterPdf.tsx` (create) | Register-only document |
| `src/app/api/pdf/[type]/[id]/route.tsx` (modify) | Signed-copy branch in `swmsPdf` |
| `tests/pdf-merge.test.ts`, `tests/swms-document.test.ts`, `tests/swms-register-pdf.test.tsx` (create) | Tests |

---

### Task 1: Migration 0064

**Files:**
- Create: `supabase/migrations/0064_uploaded_swms.sql`
- Modify: `supabase/fresh-install.sql` (append the same SQL at the end)

**Interfaces:**
- Produces: column `swms_instances.document_attachment_id uuid null`, FK constraint named `swms_instances_document_attachment_id_fkey` (`on delete restrict`); `get_shared_doc(text)` SWMS payload gains `document: {bucket, path, filename} | null`; SQL fn `is_shared_swms_document(p_bucket text, p_path text) returns boolean`; storage policy `attachments_select_shared_swms_doc` (anon select).

- [ ] **Step 1: Create the branch**

```bash
git checkout -b feat/uploaded-swms-signon
```

- [ ] **Step 2: Write the migration**

`supabase/migrations/0064_uploaded_swms.sql`:

```sql
-- 0064: uploaded (document-backed) SWMS.
--
-- A SWMS instance may now point at an uploaded PDF attachment instead of
-- carrying template structure. Sign-on, share links, versioning and audit are
-- unchanged. External signers read the PDF via a signed URL minted with the
-- anon key; the storage policy below allows that ONLY for the PDF of an active
-- SWMS that has a live signon share link.

------------------------------------------------------------------------------
-- 1. Column + FK (restrict: a PDF in use by a SWMS can't be deleted)
------------------------------------------------------------------------------

alter table swms_instances
  add column document_attachment_id uuid null;

alter table swms_instances
  add constraint swms_instances_document_attachment_id_fkey
  foreign key (document_attachment_id) references attachments(id) on delete restrict;

create index swms_instances_document_attachment_idx
  on swms_instances (document_attachment_id);

------------------------------------------------------------------------------
-- 2. get_shared_doc: SWMS payload carries the document (path only, no URL)
------------------------------------------------------------------------------

create or replace function get_shared_doc(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  l share_links%rowtype;
  v_doc jsonb;
  v_project_name text;
begin
  select * into l from share_links
   where token = p_token and active
     and (expires_at is null or expires_at > now());
  if not found then
    return null;
  end if;

  if l.kind = 'signon' and l.swms_instance_id is not null then
    select jsonb_build_object(
             'type','swms',
             'title', s.title, 'body', s.body,
             'hazards', s.hazards, 'version', s.version,
             'doc_control', s.doc_control,
             'hrcw_items', s.hrcw_items,
             'hrcw_answers', s.hrcw_answers,
             'requirements', s.requirements,
             'steps', s.steps,
             'stop_work_triggers', s.stop_work_triggers,
             'emergency_scenarios', s.emergency_scenarios,
             'emergency_contacts', s.emergency_contacts,
             'project_details', s.project_details,
             'references_list', s.references_list,
             'document', case when a.id is null then null else
               jsonb_build_object('bucket', a.bucket, 'path', a.path,
                                  'filename', a.filename) end),
           p.name
      into v_doc, v_project_name
      from swms_instances s
      left join projects p on p.id = s.project_id
      left join attachments a on a.id = s.document_attachment_id
     where s.id = l.swms_instance_id;
  elsif l.kind = 'signon' then
    select jsonb_build_object(
             'type','form',
             'name', t.name, 'kind', fs.kind,
             'schema', t.schema, 'version', fs.template_version,
             'requires_signon', t.requires_signon,
             'data', fs.data, 'submitted_at', fs.submitted_at),
           p.name
      into v_doc, v_project_name
      from form_submissions fs
      join form_templates t on t.id = fs.template_id
      left join projects p on p.id = fs.project_id
     where fs.id = l.form_submission_id;
  else -- subbie_swms
    select p.name into v_project_name from projects p where p.id = l.project_id;
    v_doc := jsonb_build_object('type','subbie_swms');
  end if;

  if v_doc is null then
    return null;
  end if;

  return jsonb_build_object(
    'kind', l.kind, 'label', l.label,
    'project_name', v_project_name, 'doc', v_doc);
end $$;

grant execute on function get_shared_doc(text) to anon, authenticated;

------------------------------------------------------------------------------
-- 3. Anon read of a live shared SWMS PDF (for signed-URL minting only)
------------------------------------------------------------------------------

create or replace function is_shared_swms_document(p_bucket text, p_path text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from share_links l
      join swms_instances s on s.id = l.swms_instance_id
      join attachments a on a.id = s.document_attachment_id
     where l.kind = 'signon'
       and l.active
       and (l.expires_at is null or l.expires_at > now())
       and s.status = 'active'
       and a.bucket = p_bucket
       and a.path = p_path
  )
$$;

revoke all on function is_shared_swms_document(text, text) from public;
grant execute on function is_shared_swms_document(text, text) to anon, authenticated;

drop policy if exists "attachments_select_shared_swms_doc" on storage.objects;
create policy "attachments_select_shared_swms_doc" on storage.objects
  for select to anon
  using (
    bucket_id = 'attachments'
    and public.is_shared_swms_document(bucket_id, name)
  );
```

- [ ] **Step 3: Append the same SQL to `supabase/fresh-install.sql`**

Append the whole file content above at the end of `supabase/fresh-install.sql`, under a header comment `-- ===== 0064_uploaded_swms.sql =====` (match how earlier migrations are appended there. Look at the end of the file for the existing separator style and copy it).

- [ ] **Step 4: Write the owner paste file (not committed)**

Write `C:\Users\nickj\AppData\Local\Temp\claude\C--Users-nickj-Documents-Devman-nexvia\c93f6d37-0a76-4ddb-8e5d-294baacf7f37\scratchpad\0064-paste.sql`: the migration content followed by

```sql
insert into supabase_migrations.schema_migrations (version, name)
values ('20260924090000', '0064_uploaded_swms')
on conflict do nothing;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0064_uploaded_swms.sql supabase/fresh-install.sql
git commit -m "feat(swms): migration 0064 — document-backed SWMS instances, shared-doc path, anon read of live shared SWMS PDFs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: PDF merge helper (pdf-lib)

**Files:**
- Modify: `package.json`, `package-lock.json` (add `pdf-lib`)
- Create: `src/lib/pdf-merge.ts`
- Test: `tests/pdf-merge.test.ts`

**Interfaces:**
- Produces:
  - `type OriginalPdfCheck = { ok: true } | { ok: false; reason: string }`
  - `checkOriginalPdf(bytes: Uint8Array | null): Promise<OriginalPdfCheck>`: reasons are exactly `'the file is missing from storage'`, `'the PDF is password-protected'`, `'the PDF has no pages'` and `'the PDF could not be read'`.
  - `appendPdf(originalBytes: Uint8Array, appendixBytes: Uint8Array): Promise<Uint8Array>`: returns original pages followed by all appendix pages.

- [ ] **Step 1: Install pdf-lib**

```bash
NODE_EXTRA_CA_CERTS=/c/Users/nickj/norton-ssl-root-ca.pem npm install pdf-lib@^1.17.1
```

- [ ] **Step 2: Write the failing tests**

`tests/pdf-merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PDFDocument, PDFName } from 'pdf-lib'
import { appendPdf, checkOriginalPdf } from '@/lib/pdf-merge'

async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([595, 842])
  return doc.save()
}

async function makeEncryptedLookingPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage()
  // Mark the trailer as encrypted — pdf-lib refuses to load such files
  // without ignoreEncryption, exactly like a real password-protected PDF.
  doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of('Standard') })
  return doc.save()
}

describe('checkOriginalPdf', () => {
  it('accepts a normal PDF', async () => {
    expect(await checkOriginalPdf(await makePdf(2))).toEqual({ ok: true })
  })

  it('reports a missing file', async () => {
    expect(await checkOriginalPdf(null)).toEqual({
      ok: false,
      reason: 'the file is missing from storage',
    })
  })

  it('reports garbage bytes as unreadable', async () => {
    const res = await checkOriginalPdf(new TextEncoder().encode('not a pdf at all'))
    expect(res).toEqual({ ok: false, reason: 'the PDF could not be read' })
  })

  it('reports an encrypted PDF as password-protected', async () => {
    const res = await checkOriginalPdf(await makeEncryptedLookingPdf())
    expect(res).toEqual({ ok: false, reason: 'the PDF is password-protected' })
  })
})

describe('appendPdf', () => {
  it('puts original pages first, then the appendix pages', async () => {
    const original = await PDFDocument.create()
    original.addPage([100, 100])
    original.addPage([100, 100])
    const appendix = await PDFDocument.create()
    appendix.addPage([200, 300])

    const merged = await PDFDocument.load(
      await appendPdf(await original.save(), await appendix.save())
    )
    expect(merged.getPageCount()).toBe(3)
    expect(merged.getPage(0).getSize()).toEqual({ width: 100, height: 100 })
    expect(merged.getPage(2).getSize()).toEqual({ width: 200, height: 300 })
  })
})
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `npx vitest run tests/pdf-merge.test.ts`
Expected: FAIL with "Failed to resolve import "@/lib/pdf-merge"".

- [ ] **Step 4: Implement**

`src/lib/pdf-merge.ts`:

```ts
import { EncryptedPDFError, PDFDocument } from 'pdf-lib'

export type OriginalPdfCheck = { ok: true } | { ok: false; reason: string }

/**
 * Can this uploaded PDF be merged into a signed copy? The reason strings are
 * printed on the register page when the original can't be attached.
 */
export async function checkOriginalPdf(
  bytes: Uint8Array | null
): Promise<OriginalPdfCheck> {
  if (!bytes || bytes.byteLength === 0) {
    return { ok: false, reason: 'the file is missing from storage' }
  }
  try {
    const doc = await PDFDocument.load(bytes)
    if (doc.getPageCount() === 0) return { ok: false, reason: 'the PDF has no pages' }
    return { ok: true }
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      return { ok: false, reason: 'the PDF is password-protected' }
    }
    return { ok: false, reason: 'the PDF could not be read' }
  }
}

/** Original pages first, then every appendix page. Call checkOriginalPdf first. */
export async function appendPdf(
  originalBytes: Uint8Array,
  appendixBytes: Uint8Array
): Promise<Uint8Array> {
  const merged = await PDFDocument.load(originalBytes)
  const appendix = await PDFDocument.load(appendixBytes)
  const pages = await merged.copyPages(appendix, appendix.getPageIndices())
  for (const page of pages) merged.addPage(page)
  return merged.save()
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/pdf-merge.test.ts`
Expected: PASS (5 tests). If the encrypted test fails because pdf-lib loads it anyway, keep the production code and change the fixture: write the saved bytes as a string, insert `/Encrypt << /Filter /Standard >>` into the `trailer <<` dictionary with string replacement, and re-encode. The goal is a trailer carrying `/Encrypt`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/pdf-merge.ts tests/pdf-merge.test.ts
git commit -m "feat(swms): pdf-lib merge helper with unreadable/encrypted detection

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Document-backed SWMS schemas and pure checks

**Files:**
- Create: `src/lib/swms-document.ts`
- Test: `tests/swms-document.test.ts`

**Interfaces:**
- Produces:
  - `swmsDocumentCreateSchema`: `{ title: string; attachment_id: string; project_id: string | null; job_id: string | null }` (exactly one parent).
  - `swmsDocumentReviseSchema`: `{ instance_id: string; attachment_id: string }`.
  - `isPdfFile(contentType: string | null | undefined, filename: string): boolean`
  - `titleFromFilename(filename: string): string`
  - `type SwmsDocumentAttachment = { parent_type: string; parent_id: string; content_type: string | null; filename: string }`
  - `checkSwmsDocumentAttachment(att: SwmsDocumentAttachment | null, parent: { type: 'job' | 'project'; id: string }): string | null` returns an error message, or null when OK.

- [ ] **Step 1: Write the failing tests**

`tests/swms-document.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  checkSwmsDocumentAttachment,
  isPdfFile,
  swmsDocumentCreateSchema,
  swmsDocumentReviseSchema,
  titleFromFilename,
} from '@/lib/swms-document'

const JOB = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ATT = '33333333-3333-4333-8333-333333333333'

describe('isPdfFile', () => {
  it('accepts application/pdf or a .pdf name', () => {
    expect(isPdfFile('application/pdf', 'x.bin')).toBe(true)
    expect(isPdfFile(null, 'SWMS-01.PDF')).toBe(true)
    expect(isPdfFile('image/png', 'photo.png')).toBe(false)
    expect(isPdfFile(undefined, 'swms.docx')).toBe(false)
  })
})

describe('titleFromFilename', () => {
  it('strips the extension and trims', () => {
    expect(titleFromFilename('RJ26001-SWMS-01 Safe Work Method Statement.pdf')).toBe(
      'RJ26001-SWMS-01 Safe Work Method Statement'
    )
    expect(titleFromFilename('  plain  ')).toBe('plain')
  })
})

describe('checkSwmsDocumentAttachment', () => {
  const parent = { type: 'job' as const, id: JOB }
  const pdf = { parent_type: 'job', parent_id: JOB, content_type: 'application/pdf', filename: 'a.pdf' }

  it('passes a PDF on the same parent', () => {
    expect(checkSwmsDocumentAttachment(pdf, parent)).toBeNull()
  })
  it('rejects a missing attachment', () => {
    expect(checkSwmsDocumentAttachment(null, parent)).toBe('That file no longer exists')
  })
  it('rejects a non-PDF', () => {
    expect(
      checkSwmsDocumentAttachment({ ...pdf, content_type: 'image/jpeg', filename: 'a.jpg' }, parent)
    ).toBe('The SWMS must be a PDF')
  })
  it('rejects a file from another job', () => {
    expect(checkSwmsDocumentAttachment({ ...pdf, parent_id: OTHER }, parent)).toBe(
      'That file belongs to a different job or project'
    )
    expect(checkSwmsDocumentAttachment({ ...pdf, parent_type: 'project' }, parent)).toBe(
      'That file belongs to a different job or project'
    )
  })
})

describe('swmsDocumentCreateSchema', () => {
  it('needs exactly one parent, a title and an attachment', () => {
    expect(
      swmsDocumentCreateSchema.safeParse({ title: 'SWMS', attachment_id: ATT, job_id: JOB }).success
    ).toBe(true)
    expect(
      swmsDocumentCreateSchema.safeParse({ title: 'SWMS', attachment_id: ATT }).success
    ).toBe(false)
    expect(
      swmsDocumentCreateSchema.safeParse({
        title: 'SWMS', attachment_id: ATT, job_id: JOB, project_id: OTHER,
      }).success
    ).toBe(false)
    const noTitle = swmsDocumentCreateSchema.safeParse({ title: '  ', attachment_id: ATT, job_id: JOB })
    expect(noTitle.success).toBe(false)
  })
})

describe('swmsDocumentReviseSchema', () => {
  it('needs the instance and the replacement file', () => {
    expect(swmsDocumentReviseSchema.safeParse({ instance_id: JOB, attachment_id: ATT }).success).toBe(true)
    expect(swmsDocumentReviseSchema.safeParse({ instance_id: JOB }).success).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/swms-document.test.ts`
Expected: FAIL (cannot resolve `@/lib/swms-document`).

- [ ] **Step 3: Implement**

`src/lib/swms-document.ts`:

```ts
import { z } from 'zod'

/**
 * Document-backed SWMS: an uploaded PDF (an attachments row) issued as a
 * swms_instance so workers can sign on to it. See migration 0064.
 */

const optionalUuid = z
  .uuid()
  .nullish()
  .transform((v) => v ?? null)

export const swmsDocumentCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(200, 'Title is too long'),
    attachment_id: z.uuid('Pick or upload the SWMS PDF'),
    project_id: optionalUuid,
    job_id: optionalUuid,
  })
  .refine(
    (d) => (d.project_id === null) !== (d.job_id === null),
    'Attach the SWMS to one project or job'
  )
export type SwmsDocumentCreateInput = z.infer<typeof swmsDocumentCreateSchema>

export const swmsDocumentReviseSchema = z.object({
  instance_id: z.uuid(),
  attachment_id: z.uuid('Pick or upload the revised PDF'),
})
export type SwmsDocumentReviseInput = z.infer<typeof swmsDocumentReviseSchema>

export function isPdfFile(contentType: string | null | undefined, filename: string): boolean {
  return contentType === 'application/pdf' || /\.pdf$/i.test(filename.trim())
}

export function titleFromFilename(filename: string): string {
  return filename.trim().replace(/\.[a-z0-9]+$/i, '').trim()
}

export type SwmsDocumentAttachment = {
  parent_type: string
  parent_id: string
  content_type: string | null
  filename: string
}

/** Error message, or null when the attachment can back a SWMS on this parent. */
export function checkSwmsDocumentAttachment(
  att: SwmsDocumentAttachment | null,
  parent: { type: 'job' | 'project'; id: string }
): string | null {
  if (!att) return 'That file no longer exists'
  if (att.parent_type !== parent.type || att.parent_id !== parent.id) {
    return 'That file belongs to a different job or project'
  }
  if (!isPdfFile(att.content_type, att.filename)) return 'The SWMS must be a PDF'
  return null
}
```

Note: the parent check runs before the PDF check. The "rejects a non-PDF" test uses a same-parent file, so the order doesn't change the expected messages.

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/swms-document.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/swms-document.ts tests/swms-document.test.ts
git commit -m "feat(swms): schemas and checks for document-backed SWMS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Server actions and the delete guard

**Files:**
- Modify: `src/lib/swms-actions.ts`
- Modify: `src/lib/attachments.ts` (`deleteAttachment`, around lines 271-278)

**Interfaces:**
- Consumes: `swmsDocumentCreateSchema`, `swmsDocumentReviseSchema` and `checkSwmsDocumentAttachment` from `@/lib/swms-document` (Task 3); column `document_attachment_id` (Task 1).
- Produces:
  - `createDocumentSwmsInstance(data: unknown): Promise<{ error?: string }>`
  - `reviseDocumentSwmsInstance(data: unknown): Promise<{ error?: string }>`
  - `reviseSwmsInstance(id)` now returns `{ error: 'Upload the revised PDF to revise this SWMS' }` for document-backed instances.

There are no unit tests here. The codebase doesn't unit-test server actions (they need a live Supabase session). The pure logic is covered by Task 3, and the actions are proven live in Task 10.

- [ ] **Step 1: Add the imports and the create action**

In `src/lib/swms-actions.ts`, add to the imports:

```ts
import {
  checkSwmsDocumentAttachment,
  swmsDocumentCreateSchema,
  swmsDocumentReviseSchema,
} from '@/lib/swms-document'
```

After `createSwmsInstance`, add:

```ts
// ─── Create instance from an uploaded PDF ────────────────────────────────────

/**
 * Issues an uploaded PDF (an attachment on the same job/project) as a
 * document-backed SWMS at version 1. Sign-on, share links and versioning work
 * exactly as for template SWMS; the structured columns stay at their defaults.
 */
export async function createDocumentSwmsInstance(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = swmsDocumentCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { title, attachment_id, project_id, job_id } = parsed.data
  const parent = job_id
    ? { type: 'job' as const, id: job_id }
    : { type: 'project' as const, id: project_id as string }

  const supabase = await createClient()
  const { data: att } = await supabase
    .from('attachments')
    .select('parent_type, parent_id, content_type, filename')
    .eq('id', attachment_id)
    .maybeSingle()
  const problem = checkSwmsDocumentAttachment(att, parent)
  if (problem) return { error: problem }

  const { error } = await supabase.from('swms_instances').insert({
    template_id: null,
    project_id,
    job_id,
    title,
    document_attachment_id: attachment_id,
    version: 1,
    status: 'active',
  })
  if (error) return { error: error.message }

  revalidateSwms(project_id, job_id)
  return {}
}
```

- [ ] **Step 2: Guard the template revise and add the document revise**

In `reviseSwmsInstance`, change the select to `'id, project_id, job_id, version, status, document_attachment_id'` and, after the `status !== 'active'` check, add:

```ts
  if (instance.document_attachment_id) {
    return { error: 'Upload the revised PDF to revise this SWMS' }
  }
```

After `reviseSwmsInstance`, add:

```ts
/**
 * Revises a document-backed SWMS: points it at the replacement PDF and bumps
 * the version in ONE update, so every worker must re-sign. The previous PDF
 * stays in Documents; the audit trigger records the file switch.
 */
export async function reviseDocumentSwmsInstance(data: unknown): Promise<Result> {
  await requireRole('admin', 'office', 'supervisor')

  const parsed = swmsDocumentReviseSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = await createClient()
  const { data: instance } = await supabase
    .from('swms_instances')
    .select('id, project_id, job_id, version, status, document_attachment_id')
    .eq('id', parsed.data.instance_id)
    .single()
  if (!instance) return { error: 'SWMS not found' }
  if (instance.status !== 'active') return { error: 'Only active SWMS can be revised' }
  if (!instance.document_attachment_id) {
    return { error: 'This SWMS was issued from a template — use Revise instead' }
  }
  if (instance.document_attachment_id === parsed.data.attachment_id) {
    return { error: 'Pick the revised PDF — that is the current file' }
  }

  const parent = instance.job_id
    ? { type: 'job' as const, id: instance.job_id as string }
    : { type: 'project' as const, id: instance.project_id as string }
  const { data: att } = await supabase
    .from('attachments')
    .select('parent_type, parent_id, content_type, filename')
    .eq('id', parsed.data.attachment_id)
    .maybeSingle()
  const problem = checkSwmsDocumentAttachment(att, parent)
  if (problem) return { error: problem }

  const { error } = await supabase
    .from('swms_instances')
    .update({
      document_attachment_id: parsed.data.attachment_id,
      version: Number(instance.version) + 1,
    })
    .eq('id', instance.id)
    .eq('version', instance.version) // compare-and-set against a concurrent revise
  if (error) return { error: error.message }

  revalidateSwms(instance.project_id, instance.job_id, instance.id)
  return {}
}
```

- [ ] **Step 3: Friendly delete error**

In `src/lib/attachments.ts` `deleteAttachment`, replace

```ts
  if (deleteError) return { error: deleteError.message }
```

with

```ts
  if (deleteError) {
    // 23503 = FK violation: swms_instances.document_attachment_id is
    // ON DELETE RESTRICT, so a PDF issued as a SWMS can't be removed.
    if (deleteError.code === '23503') {
      const { data: swms } = await supabase
        .from('swms_instances')
        .select('title')
        .eq('document_attachment_id', id)
        .limit(1)
        .maybeSingle()
      return {
        error: `This file is the PDF for SWMS '${swms?.title ?? 'untitled'}' and is kept for its sign-on record — it can't be deleted`,
      }
    }
    return { error: deleteError.message }
  }
```

(The FK holds even after a supersede, which is correct for audit. That's why the message doesn't tell them to supersede first.)

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/swms-actions.ts src/lib/attachments.ts
git commit -m "feat(swms): create/revise actions for uploaded-PDF SWMS; block deleting a PDF in use

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Queries (list rows and document options)

**Files:**
- Modify: `src/lib/swms-queries.ts`
- Modify: `src/app/(office)/jobs/[id]/page.tsx` (around line 100-110 and 351-358)
- Modify: `src/app/(office)/projects/[id]/whs/page.tsx` (around line 55-60 and 144-150)

**Interfaces:**
- Consumes: `isPdfFile` from `@/lib/swms-document`.
- Produces:
  - `SwmsInstanceListRow.document: { id: string; filename: string } | null`
  - `interface SwmsDocumentOption { id: string; filename: string; created_at: string }`
  - `fetchSwmsDocumentOptions(supabase: SupabaseClient, parentType: 'project' | 'job', parentId: string): Promise<SwmsDocumentOption[]>`: PDF attachments on that parent, newest first.
  - `SwmsInstancesSection` gains the required prop `documents: SwmsDocumentOption[]` (wired in Task 6. In this task, pass it from both pages and add it to the props interface only).

- [ ] **Step 1: Extend `fetchSwmsInstances`**

In the `swms_instances` select, change it to:

```ts
      .select(
        'id, title, steps, hazards, version, status, created_at, document_attachment_id, document:attachments!swms_instances_document_attachment_id_fkey(id, filename)'
      )
```

Add `document: { id: string; filename: string } | null` to `SwmsInstanceListRow` (with a doc comment: `/** Set for SWMS issued from an uploaded PDF. */`). In the mapped return, add:

```ts
      document:
        (instance.document as unknown as { id: string; filename: string } | null) ?? null,
```

- [ ] **Step 2: Add `fetchSwmsDocumentOptions`**

Append to `src/lib/swms-queries.ts` (add `import { isPdfFile } from '@/lib/swms-document'`):

```ts
export interface SwmsDocumentOption {
  id: string
  filename: string
  created_at: string
}

/** PDF attachments on a job/project — candidates to issue as a SWMS. */
export async function fetchSwmsDocumentOptions(
  supabase: SupabaseClient,
  parentType: 'project' | 'job',
  parentId: string
): Promise<SwmsDocumentOption[]> {
  const { data } = await supabase
    .from('attachments')
    .select('id, filename, content_type, created_at')
    .eq('parent_type', parentType)
    .eq('parent_id', parentId)
    .order('created_at', { ascending: false })
  return (data ?? [])
    .filter((a) => isPdfFile(a.content_type as string | null, a.filename as string))
    .map((a) => ({
      id: a.id as string,
      filename: a.filename as string,
      created_at: a.created_at as string,
    }))
}
```

- [ ] **Step 3: Wire the pages**

In both pages, add `fetchSwmsDocumentOptions(supabase, 'job', id)` (job page) or `fetchSwmsDocumentOptions(supabase, 'project', id)` (project WHS page) to the existing `Promise.all`. Destructure it as `swmsDocuments` and pass `documents={swmsDocuments}` to `<SwmsInstancesSection …>`. In `SwmsInstancesSection.tsx`, add `documents: SwmsDocumentOption[]` to `SwmsInstancesSectionProps` (import the type from `@/lib/swms-queries`) and destructure it (it's unused until Task 6. Prefix it with `_` only if lint complains).

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit` and then `npx vitest run tests/swms.test.ts tests/swms-document.test.ts`
Expected: no type errors; tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/swms-queries.ts "src/app/(office)/jobs/[id]/page.tsx" "src/app/(office)/projects/[id]/whs/page.tsx" src/components/SwmsInstancesSection.tsx
git commit -m "feat(swms): list rows carry the source PDF; PDF options per job/project

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Office UI (issue from PDF, revise with PDF, signed copy)

**Files:**
- Create: `src/lib/upload-attachment-client.ts`
- Create: `src/components/SwmsDocumentForms.tsx`
- Modify: `src/components/SwmsInstancesSection.tsx`

**Interfaces:**
- Consumes: `createDocumentSwmsInstance` and `reviseDocumentSwmsInstance` (Task 4); `SwmsDocumentOption` and `SwmsInstanceListRow.document` (Task 5); `titleFromFilename` and `isPdfFile` (Task 3); `recordAttachment` (`@/lib/attachments`); `buildStorageKey`, `safeContentType`, `validateUploadFile` and `removeUploadedObject` (`@/lib/storage-keys`).
- Produces:
  - `uploadAttachmentFile(input: { parentType: string; parentId: string; file: File; kind: 'document' }): Promise<{ id: string } | { error: string }>`
  - `<AddDocumentSwmsForm parentType parentId documents onDone />`
  - `<ReviseDocumentSwmsDialog instanceId parentType parentId documents currentAttachmentId />`

- [ ] **Step 1: Upload helper**

`src/lib/upload-attachment-client.ts`:

```ts
'use client'

import { createClient } from '@/lib/supabase/client'
import { recordAttachment } from '@/lib/attachments'
import {
  buildStorageKey,
  removeUploadedObject,
  safeContentType,
  validateUploadFile,
} from '@/lib/storage-keys'

/**
 * Two-phase upload (storage object, then attachments row) returning the new
 * attachment id — the same flow as PhotoUpload, with compensating cleanup.
 */
export async function uploadAttachmentFile(input: {
  parentType: string
  parentId: string
  file: File
  kind: 'document'
}): Promise<{ id: string } | { error: string }> {
  const invalid = validateUploadFile(input.file)
  if (invalid) return { error: invalid }

  const supabase = createClient()
  const path = buildStorageKey(`${input.parentType}/${input.parentId}`, input.file.name)
  const contentType = safeContentType(input.file.type)

  const { error: storageError } = await supabase.storage
    .from('attachments')
    .upload(path, input.file, { contentType, upsert: false })
  if (storageError) return { error: storageError.message }

  try {
    const result = await recordAttachment({
      parent_type: input.parentType,
      parent_id: input.parentId,
      path,
      filename: input.file.name,
      content_type: contentType,
      size: input.file.size,
      kind: input.kind,
      caption: null,
      meta: null,
    })
    if (result.error || !result.id) {
      await removeUploadedObject(supabase, path)
      return { error: result.error ?? 'Could not save the file' }
    }
    return { id: result.id }
  } catch (err) {
    await removeUploadedObject(supabase, path)
    return { error: err instanceof Error ? err.message : 'Upload failed' }
  }
}
```

- [ ] **Step 2: PDF picker and forms**

`src/components/SwmsDocumentForms.tsx`:

```tsx
'use client'

import React, { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { fmtDate } from '@/lib/format'
import { createDocumentSwmsInstance, reviseDocumentSwmsInstance } from '@/lib/swms-actions'
import { isPdfFile, titleFromFilename } from '@/lib/swms-document'
import type { SwmsDocumentOption } from '@/lib/swms-queries'
import { uploadAttachmentFile } from '@/lib/upload-attachment-client'

type PdfChoice =
  | { mode: 'existing'; attachmentId: string }
  | { mode: 'upload'; file: File | null }

/** Pick an existing job/project PDF or choose a new one to upload. */
function PdfPicker({
  idPrefix,
  documents,
  excludeId,
  value,
  onChange,
}: {
  idPrefix: string
  documents: SwmsDocumentOption[]
  excludeId?: string
  value: PdfChoice
  onChange: (choice: PdfChoice, suggestedTitle: string) => void
}) {
  const options = documents.filter((d) => d.id !== excludeId)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={value.mode === 'existing' ? 'secondary' : 'outline'}
          onClick={() => onChange({ mode: 'existing', attachmentId: '' }, '')}
          disabled={options.length === 0}
        >
          From Documents
        </Button>
        <Button
          type="button"
          size="sm"
          variant={value.mode === 'upload' ? 'secondary' : 'outline'}
          onClick={() => onChange({ mode: 'upload', file: null }, '')}
        >
          Upload new PDF
        </Button>
      </div>
      {value.mode === 'existing' ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-existing`}>PDF</Label>
          <Select
            value={value.attachmentId}
            onValueChange={(v) => {
              const id = v ?? ''
              const doc = options.find((d) => d.id === id)
              onChange({ mode: 'existing', attachmentId: id }, doc ? titleFromFilename(doc.filename) : '')
            }}
          >
            <SelectTrigger id={`${idPrefix}-existing`} className="w-full">
              <SelectValue placeholder="Pick a PDF from Documents" />
            </SelectTrigger>
            <SelectContent>
              {options.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.filename} · {fmtDate(d.created_at)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${idPrefix}-upload`}>PDF</Label>
          <Input
            id={`${idPrefix}-upload`}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null
              onChange({ mode: 'upload', file }, file ? titleFromFilename(file.name) : '')
            }}
          />
          <p className="text-xs text-muted-foreground">
            The file is also added to this page&apos;s Documents.
          </p>
        </div>
      )}
    </div>
  )
}

function initialChoice(documents: SwmsDocumentOption[], excludeId?: string): PdfChoice {
  return documents.some((d) => d.id !== excludeId)
    ? { mode: 'existing', attachmentId: '' }
    : { mode: 'upload', file: null }
}

/** Resolve the choice to an attachment id, uploading first when needed. */
async function resolveAttachmentId(
  choice: PdfChoice,
  parentType: 'project' | 'job',
  parentId: string
): Promise<{ id: string } | { error: string }> {
  if (choice.mode === 'existing') {
    return choice.attachmentId ? { id: choice.attachmentId } : { error: 'Pick a PDF' }
  }
  if (!choice.file) return { error: 'Choose a PDF to upload' }
  if (!isPdfFile(choice.file.type, choice.file.name)) {
    return { error: 'The SWMS must be a PDF' }
  }
  return uploadAttachmentFile({ parentType, parentId, file: choice.file, kind: 'document' })
}

export function AddDocumentSwmsForm({
  parentType,
  parentId,
  documents,
  onDone,
}: {
  parentType: 'project' | 'job'
  parentId: string
  documents: SwmsDocumentOption[]
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<PdfChoice>(() => initialChoice(documents))
  const [title, setTitle] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const att = await resolveAttachmentId(choice, parentType, parentId)
      if ('error' in att) {
        toast.error(att.error)
        return
      }
      const result = await createDocumentSwmsInstance({
        title,
        attachment_id: att.id,
        project_id: parentType === 'project' ? parentId : null,
        job_id: parentType === 'job' ? parentId : null,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('SWMS issued — field staff can now sign on')
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <PdfPicker
        idPrefix="swms-doc"
        documents={documents}
        value={choice}
        onChange={(next, suggested) => {
          setChoice(next)
          if (suggested && !title.trim()) setTitle(suggested)
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="swms-doc-title">Title</Label>
        <Input
          id="swms-doc-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Asbestos removal SWMS"
          required
        />
      </div>
      <DialogFooter>
        <Button type="submit" disabled={pending}>
          {pending ? 'Issuing…' : 'Issue SWMS'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ReviseDocumentSwmsDialog({
  instanceId,
  parentType,
  parentId,
  documents,
  currentAttachmentId,
  disabled,
}: {
  instanceId: string
  parentType: 'project' | 'job'
  parentId: string
  documents: SwmsDocumentOption[]
  currentAttachmentId: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<PdfChoice>(() =>
    initialChoice(documents, currentAttachmentId)
  )

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const att = await resolveAttachmentId(choice, parentType, parentId)
      if ('error' in att) {
        toast.error(att.error)
        return
      }
      const result = await reviseDocumentSwmsInstance({
        instance_id: instanceId,
        attachment_id: att.id,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('SWMS revised — everyone must sign on again')
      setOpen(false)
    })
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        Revise
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revise SWMS with a new PDF</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The version goes up and everyone who signed must sign on again. The
              current PDF stays in Documents.
            </p>
            <PdfPicker
              idPrefix={`swms-revise-${instanceId}`}
              documents={documents}
              excludeId={currentAttachmentId}
              value={choice}
              onChange={(next) => setChoice(next)}
            />
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Revising…' : 'Revise SWMS'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
```

- [ ] **Step 3: Wire it into `SwmsInstancesSection.tsx`**

1. Import `AddDocumentSwmsForm` and `ReviseDocumentSwmsDialog` from `@/components/SwmsDocumentForms`.
2. `SwmsInstancesSection`: pass `documents` to `AddSwmsDialog`, and pass `parentType`, `parentId` and `documents` to each `SwmsInstanceCard`.
3. `AddSwmsDialog`: add `documents: SwmsDocumentOption[]` to its props and `const [source, setSource] = useState<'template' | 'document'>('template')`. In `reset()`, add `setSource('template')`. Directly under `<DialogHeader>…</DialogHeader>`, render:

```tsx
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={source === 'template' ? 'secondary' : 'outline'}
              onClick={() => setSource('template')}
            >
              From template
            </Button>
            <Button
              type="button"
              size="sm"
              variant={source === 'document' ? 'secondary' : 'outline'}
              onClick={() => setSource('document')}
            >
              Uploaded PDF
            </Button>
          </div>
          {source === 'document' ? (
            <AddDocumentSwmsForm
              parentType={parentType}
              parentId={parentId}
              documents={documents}
              onDone={() => {
                setOpen(false)
                reset()
              }}
            />
          ) : (
            /* the existing <form onSubmit={handleSubmit} …>…</form> unchanged */
          )}
```

The existing template `<form>` moves inside the `: (...)` branch unchanged.

4. `SwmsInstanceCard`: accept `parentType`, `parentId` and `documents`. Next to the version badge, when `instance.document` is set, render:

```tsx
            {instance.document && (
              <Badge variant="outline" className="max-w-[16rem] truncate" title={instance.document.filename}>
                PDF · {instance.document.filename}
              </Badge>
            )}
```

Change the PDF button label to `{instance.document ? 'Signed copy' : 'PDF'}`. Replace the Revise button block with:

```tsx
          {canManage && isActive && (instance.document ? (
            <ReviseDocumentSwmsDialog
              instanceId={instance.id}
              parentType={parentType}
              parentId={parentId}
              documents={documents}
              currentAttachmentId={instance.document.id}
              disabled={pending}
            />
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={handleRevise} disabled={pending}>
              Revise
            </Button>
          ))}
```

5. The empty-state copy is fine as is.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` and then `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/upload-attachment-client.ts src/components/SwmsDocumentForms.tsx src/components/SwmsInstancesSection.tsx
git commit -m "feat(swms): issue a SWMS from an uploaded PDF, revise with a new PDF, signed-copy button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Open PDF on the field and public sign pages

**Files:**
- Create: `src/components/SwmsDocumentLink.tsx`
- Modify: `src/app/field/swms/[instanceId]/page.tsx`
- Modify: `src/app/sign/[token]/page.tsx`

**Interfaces:**
- Consumes: column `document_attachment_id` and FK name (Task 1); `get_shared_doc` `doc.document` (Task 1); anon storage policy (Task 1).
- Produces: `<SwmsDocumentLink url={string | null} filename={string} />` (a server-safe component with no hooks).

- [ ] **Step 1: The link component**

`src/components/SwmsDocumentLink.tsx`:

```tsx
import { ExternalLinkIcon, FileTextIcon } from 'lucide-react'

/**
 * "Open PDF" block for a SWMS issued from an uploaded PDF. Opens in a new tab
 * so the phone's own PDF viewer handles it. url = 1h signed storage URL, or
 * null when the file couldn't be found (sign-on still allowed).
 */
export function SwmsDocumentLink({ url, filename }: { url: string | null; filename: string }) {
  if (!url) {
    return (
      <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
        The SWMS file is unavailable — contact the office.
      </p>
    )
  }
  return (
    <section className="flex flex-col gap-2">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 rounded-xl border px-4 py-4 hover:bg-muted"
      >
        <FileTextIcon className="size-6 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-semibold">Open PDF</span>
          <span className="truncate text-xs text-muted-foreground">{filename}</span>
        </span>
        <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" />
      </a>
      <p className="text-sm text-muted-foreground">
        Read the full SWMS before signing on.
      </p>
    </section>
  )
}
```

- [ ] **Step 2: Field page**

In `src/app/field/swms/[instanceId]/page.tsx`:
- Extend the instance select with `document_attachment_id, document:attachments!swms_instances_document_attachment_id_fkey(bucket, path, filename)` (add it after `status,`).
- After the instance is loaded, add:

```tsx
  const documentRel = instance.document as unknown as {
    bucket: string
    path: string
    filename: string
  } | null
  let documentUrl: string | null = null
  if (documentRel) {
    const { data: signed } = await supabase.storage
      .from(documentRel.bucket ?? 'attachments')
      .createSignedUrl(documentRel.path, 3600)
    documentUrl = signed?.signedUrl ?? null
  }
```

- Replace `<SwmsFullView structure={structure} />` with:

```tsx
      {documentRel ? (
        <SwmsDocumentLink url={documentUrl} filename={documentRel.filename} />
      ) : (
        <SwmsFullView structure={structure} />
      )}
```

(Field users can already read `job/…` and `project/…` objects under `attachments_select_scoped`. This was checked live on 2026-09-24.)

- [ ] **Step 3: Public sign page**

In `src/app/sign/[token]/page.tsx`:
- Add `document?: { bucket: string; path: string; filename: string } | null` to `SharedSwmsDoc`.
- Import `SwmsDocumentLink`.
- After `const doc = shared.doc`, add:

```tsx
  // Uploaded-PDF SWMS: mint a 1h signed URL with the anon key. Storage policy
  // attachments_select_shared_swms_doc (0064) allows it only while this SWMS
  // is active and has a live signon link — the token was validated above.
  let documentUrl: string | null = null
  if (doc.type === 'swms' && doc.document) {
    const { data: signed } = await supabase.storage
      .from(doc.document.bucket ?? 'attachments')
      .createSignedUrl(doc.document.path, 3600)
    documentUrl = signed?.signedUrl ?? null
  }
```

- Replace the `SwmsReadThrough` branch with:

```tsx
      {doc.type === 'swms' ? (
        doc.document ? (
          <SwmsDocumentLink url={documentUrl} filename={doc.document.filename} />
        ) : (
          <SwmsReadThrough doc={doc} />
        )
      ) : (
        <FormReadThrough doc={doc} />
      )}
```

- In the blue intro paragraph, the word "below" still reads fine for both. Leave the copy alone.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` and then `npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/SwmsDocumentLink.tsx "src/app/field/swms/[instanceId]/page.tsx" "src/app/sign/[token]/page.tsx"
git commit -m "feat(swms): Open PDF on field and public sign-on pages for uploaded SWMS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Register-only PDF component

**Files:**
- Modify: `src/pdf/SwmsPdf.tsx`
- Create: `src/pdf/SwmsRegisterPdf.tsx`
- Test: `tests/swms-register-pdf.test.tsx`

**Interfaces:**
- Consumes: `DocShell` and `DocCompany` (`./DocShell`); `SwmsPdfSignature` and `SwmsPdfChange` types.
- Produces:
  - Exports from `SwmsPdf.tsx`: `SectionTable`, `LabelValueRows`, `SignatureTable`, and the new `ChangeRecordTable({ changes }: { changes: SwmsPdfChange[] })`, which is the existing "Review & change record" block extracted. `SwmsPdf` uses it, so the output is unchanged.
  - `SwmsRegisterPdf(props: SwmsRegisterPdfProps)`, where:

```ts
export type SwmsRegisterPdfProps = {
  swms: { title: string; parentLabel: string; version: number; status: string; date: string }
  company: DocCompany
  sourceFilename: string
  /** Pre-formatted generation date/time. */
  generatedAt: string
  signatures: SwmsPdfSignature[]
  earlierSignatureCount: number
  changes: SwmsPdfChange[]
  /** Set when the original PDF could not be attached, e.g. "the PDF is password-protected". */
  originalProblem: string | null
}
```

- [ ] **Step 1: Write the failing test**

`tests/swms-register-pdf.test.tsx`:

```tsx
import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { SwmsRegisterPdf } from '../src/pdf/SwmsRegisterPdf'

const company = {
  name: 'Test Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW',
  phone: '02 9000 0000',
  email: 'office@test.example',
  logoUrl: undefined,
}

const base = {
  swms: {
    title: 'RJ26001-SWMS-01',
    parentLabel: 'J-0042 — Asbestos removal',
    version: 2,
    status: 'active',
    date: '24/09/2026',
  },
  company,
  sourceFilename: 'RJ26001-SWMS-01 Safe Work Method Statement.pdf',
  generatedAt: '24/09/2026 10:15',
  signatures: [
    { name: 'Sam Worker', role: 'Field', company: 'Test Civil Pty Ltd', date: '24/09/2026', version: 2, imageUrl: null },
    { name: 'Ext Sub', role: 'External', company: 'Sub Co', date: '24/09/2026', version: 2, imageUrl: null },
  ],
  earlierSignatureCount: 3,
  changes: [{ date: '20/09/2026', description: 'Issued (v1)', by: 'Office' }],
}

test('register pdf renders with signatures', async () => {
  const buffer = await renderToBuffer(<SwmsRegisterPdf {...base} originalProblem={null} />)
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})

test('register pdf renders the fallback note when the original is unusable', async () => {
  const buffer = await renderToBuffer(
    <SwmsRegisterPdf {...base} signatures={[]} originalProblem="the PDF is password-protected" />
  )
  expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/swms-register-pdf.test.tsx --maxWorkers=1`
Expected: FAIL (cannot resolve `../src/pdf/SwmsRegisterPdf`).

- [ ] **Step 3: Export the building blocks and extract `ChangeRecordTable`**

In `src/pdf/SwmsPdf.tsx`: add `export` to `function SectionTable`, `function LabelValueRows` and `function SignatureTable`. Add:

```tsx
export function ChangeRecordTable({ changes }: { changes: SwmsPdfChange[] }) {
  if (changes.length === 0) return null
  return (
    <SectionTable title="Review & change record">
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, changeCol.date]}>Date</Text>
        <Text style={[tableStyles.headCell, changeCol.description]}>Change</Text>
        <Text style={[tableStyles.headCell, changeCol.by]}>By</Text>
      </View>
      {changes.map((c, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, changeCol.date]}>{c.date}</Text>
          <Text style={[tableStyles.cell, changeCol.description]}>{c.description}</Text>
          <Text style={[tableStyles.cell, changeCol.by]}>{c.by}</Text>
        </View>
      ))}
    </SectionTable>
  )
}
```

In `SwmsPdf`, replace the inline `{changes.length > 0 && (<SectionTable title="Review & change record">…</SectionTable>)}` block with `<ChangeRecordTable changes={changes} />`.

- [ ] **Step 4: Implement `SwmsRegisterPdf`**

`src/pdf/SwmsRegisterPdf.tsx`:

```tsx
import { Text, View, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import {
  ChangeRecordTable,
  LabelValueRows,
  SectionTable,
  SignatureTable,
  type SwmsPdfChange,
  type SwmsPdfSignature,
} from './SwmsPdf'
import { palette, fontSize } from './theme'

export type SwmsRegisterPdfProps = {
  swms: { title: string; parentLabel: string; version: number; status: string; date: string }
  company: DocCompany
  sourceFilename: string
  /** Pre-formatted generation date/time. */
  generatedAt: string
  signatures: SwmsPdfSignature[]
  earlierSignatureCount: number
  changes: SwmsPdfChange[]
  /** Set when the original PDF could not be attached, e.g. "the PDF is password-protected". */
  originalProblem: string | null
}

const styles = StyleSheet.create({
  problem: {
    fontSize: fontSize.base,
    color: palette.slate900,
    borderWidth: 1,
    borderColor: palette.slate400,
    padding: 8,
    marginBottom: 10,
  },
})

/**
 * Sign-on register appended to an uploaded SWMS PDF (the "signed copy").
 * Rendered alone when the original can't be attached.
 */
export function SwmsRegisterPdf({
  swms,
  company,
  sourceFilename,
  generatedAt,
  signatures,
  earlierSignatureCount,
  changes,
  originalProblem,
}: SwmsRegisterPdfProps) {
  return (
    <DocShell
      title="SWMS sign-on register"
      docNumber={swms.title}
      docDate={swms.date}
      company={company}
      footerText={`SWMS — ${swms.title} (v${swms.version}) — ${swms.parentLabel}`}
    >
      {originalProblem && (
        <View>
          <Text style={styles.problem}>
            Original PDF could not be attached ({originalProblem}) — download it
            separately from Documents.
          </Text>
        </View>
      )}
      <SectionTable title="SWMS">
        <LabelValueRows
          rows={[
            { label: 'Title', value: swms.title },
            { label: 'Job / project', value: swms.parentLabel },
            { label: 'Version', value: `v${swms.version} (${swms.status})` },
            { label: 'Source file', value: sourceFilename },
            { label: 'Register generated', value: generatedAt },
          ]}
        />
      </SectionTable>
      <SignatureTable signatures={signatures} earlierSignatureCount={earlierSignatureCount} />
      <ChangeRecordTable changes={changes} />
    </DocShell>
  )
}
```

Check `src/pdf/theme.ts` for the palette keys used (`slate900`, `slate400`) and `fontSize.base`. Both are already used in `SwmsPdf.tsx`, so they exist.

- [ ] **Step 5: Run the tests and confirm they pass (plus the existing PDF tests)**

Run: `npx vitest run tests/swms-register-pdf.test.tsx tests/po-pdf.test.tsx --maxWorkers=1`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pdf/SwmsPdf.tsx src/pdf/SwmsRegisterPdf.tsx tests/swms-register-pdf.test.tsx
git commit -m "feat(swms): register-only PDF for uploaded SWMS signed copies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Signed-copy branch in the PDF route

**Files:**
- Modify: `src/app/api/pdf/[type]/[id]/route.tsx` (`swmsPdf`, lines ~764-935)

**Interfaces:**
- Consumes: `checkOriginalPdf` and `appendPdf` (Task 2); `SwmsRegisterPdf` (Task 8); FK name (Task 1).

- [ ] **Step 1: Select the document**

In `swmsPdf`'s instance select, add `document_attachment_id, document:attachments!swms_instances_document_attachment_id_fkey(bucket, path, filename)` after `created_at,`.

- [ ] **Step 2: Branch after `changes` is built (before `docControlRows`)**

Add imports at the top of the route: `import { SwmsRegisterPdf } from '@/pdf/SwmsRegisterPdf'` and `import { appendPdf, checkOriginalPdf } from '@/lib/pdf-merge'`. Check how `fmtDate` is imported there, and whether a date-time formatter exists in `@/lib/format` (e.g. `fmtDateTime`). Use it for `generatedAt` if it does. Otherwise use `fmtDate(new Date().toISOString())`.

Insert:

```tsx
  const documentRel = instance.document as unknown as {
    bucket: string
    path: string
    filename: string
  } | null
  if (documentRel) {
    // Uploaded-PDF SWMS → "signed copy": original pages + register pages.
    let originalBytes: Uint8Array | null = null
    const { data: blob } = await supabase.storage
      .from(documentRel.bucket ?? 'attachments')
      .download(documentRel.path)
    if (blob) originalBytes = new Uint8Array(await blob.arrayBuffer())
    const check = await checkOriginalPdf(originalBytes)

    const register = await renderToBuffer(
      <SwmsRegisterPdf
        swms={{
          title: instance.title,
          parentLabel,
          version: currentVersion,
          status: instance.status,
          date: fmtDate(instance.created_at),
        }}
        company={toCompany(settings)}
        sourceFilename={documentRel.filename}
        generatedAt={fmtDate(new Date().toISOString())}
        signatures={pdfSignatures}
        earlierSignatureCount={earlierSignatureCount}
        changes={changes}
        originalProblem={check.ok ? null : check.reason}
      />
    )
    const bytes =
      check.ok && originalBytes
        ? await appendPdf(originalBytes, new Uint8Array(register))
        : new Uint8Array(register)

    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="swms-v${currentVersion}-signed.pdf"`,
      },
    })
  }
```

If TypeScript rejects `new Response(bytes)` for a `Uint8Array<ArrayBufferLike>`, wrap it as `new Response(Buffer.from(bytes))`, matching whatever the file already does elsewhere.

- [ ] **Step 3: Typecheck, lint and run all tests**

Run: `npx tsc --noEmit`, then `npm run lint`, then `npx vitest run --maxWorkers=1`
Expected: all clean, and the full suite green (≥ 745 existing + the new tests).

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/pdf/[type]/[id]/route.tsx"
git commit -m "feat(swms): signed-copy PDF — original uploaded SWMS followed by the sign-on register

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Apply, prove, ship (controller with the owner)

This task isn't for a subagent. The controller runs it with the owner.

- [ ] **Step 1: Final review.** Run a code review of the branch diff against the spec (superpowers:requesting-code-review). Fix any findings.
- [ ] **Step 2: Owner applies migration 0064.** Hand the owner the scratchpad `0064-paste.sql` to paste into the Supabase SQL editor. Verify live via the ecr-portal `sql` tool:
  - `select column_name from information_schema.columns where table_name='swms_instances' and column_name='document_attachment_id'` gives 1 row.
  - `select polname from pg_policy where polname='attachments_select_shared_swms_doc'` gives 1 row.
  - `select version from supabase_migrations.schema_migrations where name='0064_uploaded_swms'` gives 1 row.
- [ ] **Step 3: Local proof (dev server with the Norton CA env, `preview_start`).** Log in as admin. On a zz-prefixed test job, upload a zz PDF to Documents, then do Add SWMS → Uploaded PDF → From Documents → issue. Check that the card shows the PDF badge and a "Signed copy" button. Log in as field1 on a mobile viewport, go to /field/swms, open it, tap **Open PDF** (confirm a 200 PDF) and sign. As admin, create a share link, open `/sign/<token>` in a fresh (logged-out) tab, check that Open PDF returns 200, and sign externally. Download the signed copy and confirm the original page(s) come first, then the register with both signers. Revise with a second zz PDF and confirm the version bumps and field1 sees "re-sign". Try to delete the in-use PDF from Documents and confirm the friendly error appears. Deactivate the share link and confirm anon `createSignedUrl` on the path now fails.
- [ ] **Step 4: Clean up all zz data** (instances, signatures, share links, attachments and storage objects, audit rows per house rules in the ecr-portal `help`).
- [ ] **Step 5: Ship (confirm with the owner first).** Merge `feat/uploaded-swms-signon` into `main` and push. The push auto-deploys to Vercel. Re-run the external sign-on proof against production on a zz job, then clean up.
- [ ] **Step 6: Update memory** with a short project memory for this feature (what shipped, the migration number, the anon storage-policy mechanism).
