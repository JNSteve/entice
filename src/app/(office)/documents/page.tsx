import { getProfile, requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import {
  versionOrdinal,
  fetchAckRegister,
  type AckRegisterRow,
} from '@/lib/document-queries'
import type { DocCategory, DocSystem, DocStatus } from '@/lib/zod'
import { DocumentsTable, type DocumentRow } from './documents-table'

export default async function DocumentsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const me = await getProfile()

  const supabase = await createClient()

  const { data: docs } = await supabase
    .from('documents')
    .select(
      `id, title, category, system, doc_number, version, status, supersedes_id,
       file_path, filename, content_type, size, review_due, notes,
       reviewed_by, reviewed_at, approved_by, approved_at, issued_at, created_at,
       uploader:profiles!documents_uploaded_by_fkey(full_name),
       approver:profiles!documents_approved_by_fkey(full_name)`
    )
    .order('created_at', { ascending: false })

  // Batch-sign the files (private bucket). Drafts may have no file.
  const paths = (docs ?? [])
    .map((d) => d.file_path as string | null)
    .filter((p): p is string => Boolean(p))
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  // Version ordinal per row (chain depth) for acknowledgements.
  const supersedesById = new Map<string, string | null>(
    (docs ?? []).map((d) => [d.id as string, (d.supersedes_id as string | null) ?? null])
  )

  // Acknowledgement registers for issued documents only (current version).
  const issued = (docs ?? []).filter((d) => d.status === 'issued')
  const ackRegisters = new Map<string, AckRegisterRow[]>()
  await Promise.all(
    issued.map(async (d) => {
      const ord = versionOrdinal(d.id as string, supersedesById)
      const register = await fetchAckRegister(supabase, d.id as string, ord)
      ackRegisters.set(d.id as string, register)
    })
  )

  const myId = me?.id ?? null
  const rows: DocumentRow[] = (docs ?? []).map((d) => {
    const uploaderRel = d.uploader as unknown as { full_name: string } | null
    const approverRel = d.approver as unknown as { full_name: string } | null
    const ord = versionOrdinal(d.id as string, supersedesById)
    const register = ackRegisters.get(d.id as string) ?? null
    const myAck = register?.find((r) => r.user_id === myId)?.acknowledged_at ?? null
    return {
      id: d.id as string,
      title: d.title as string,
      category: d.category as DocCategory,
      system: d.system as DocSystem,
      doc_number: (d.doc_number as string | null) ?? null,
      version: d.version as string,
      versionOrdinal: ord,
      status: d.status as DocStatus,
      supersedes_id: (d.supersedes_id as string | null) ?? null,
      file_path: (d.file_path as string | null) ?? null,
      filename: (d.filename as string | null) ?? null,
      review_due: (d.review_due as string | null) ?? null,
      notes: (d.notes as string | null) ?? null,
      approved_at: (d.approved_at as string | null) ?? null,
      issued_at: (d.issued_at as string | null) ?? null,
      created_at: d.created_at as string,
      uploaded_by_name: uploaderRel?.full_name ?? null,
      approved_by_name: approverRel?.full_name ?? null,
      file_url: d.file_path ? urlByPath.get(d.file_path as string) ?? null : null,
      register,
      myAcknowledgedAt: myAck,
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Document register"
        description="Company-wide controlled documents — QMS, EMS and OHS policies, procedures, work instructions, forms and registers — with a formal approval workflow and read acknowledgement (ISO 9001 §7.5)."
      />
      <DocumentsTable
        rows={rows}
        canManage={profile.role === 'admin' || profile.role === 'office'}
        isAdmin={profile.role === 'admin'}
      />
    </div>
  )
}
