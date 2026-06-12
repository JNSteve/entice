import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import type { WhsDocCategory, WhsDocStatus } from '@/lib/zod'
import { DocumentsTable, type WhsDocumentRow } from './documents-table'

export default async function WhsDocumentsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const { data: docs } = await supabase
    .from('whs_documents')
    .select(
      `id, title, category, doc_number, version, status, supersedes_id,
       file_path, filename, content_type, size, review_due, notes, created_at,
       profiles!whs_documents_uploaded_by_fkey(full_name)`
    )
    .order('created_at', { ascending: false })

  // Batch-sign the files (private bucket — downloads go through short-lived
  // signed URLs, same approach as the subbie SWMS queue).
  const paths = (docs ?? []).map((d) => d.file_path as string)
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(paths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const rows: WhsDocumentRow[] = (docs ?? []).map((d) => {
    const uploaderRel = d.profiles as unknown as { full_name: string } | null
    return {
      id: d.id as string,
      title: d.title as string,
      category: d.category as WhsDocCategory,
      doc_number: (d.doc_number as string | null) ?? null,
      version: d.version as string,
      status: d.status as WhsDocStatus,
      supersedes_id: (d.supersedes_id as string | null) ?? null,
      file_path: d.file_path as string,
      filename: d.filename as string,
      review_due: (d.review_due as string | null) ?? null,
      notes: (d.notes as string | null) ?? null,
      created_at: d.created_at as string,
      uploaded_by_name: uploaderRel?.full_name ?? null,
      file_url: urlByPath.get(d.file_path as string) ?? null,
    }
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Document library"
        description="Controlled WHS documents — policies, procedures, plans, SDS and blank forms — with version control and review dates."
      />
      <DocumentsTable
        rows={rows}
        canManage={profile.role === 'admin' || profile.role === 'office'}
        isAdmin={profile.role === 'admin'}
      />
    </div>
  )
}
