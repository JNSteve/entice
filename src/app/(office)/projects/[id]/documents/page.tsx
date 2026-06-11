import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PhotoUpload } from '@/components/PhotoUpload'
import { AttachmentList } from '@/components/AttachmentList'
import { DocketTable, type DocketRow, type CostCodeOption } from '@/components/DocketTable'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'

export default async function ProjectDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, attachments, { data: costCodes }] = await Promise.all([
    supabase.from('projects').select('id').eq('id', id).single(),
    fetchAttachmentsWithUrls(supabase, 'project', id),
    supabase.from('cost_codes').select('id, code, name').eq('active', true).order('code'),
  ])

  if (!project) notFound()

  const canUpload = profile.role === 'admin' || profile.role === 'office'
  const canDeleteAttachment = canUpload
  const canCreateCost = canUpload

  const photos = attachments.filter((a) => a.kind === 'photo')
  const dockets = attachments.filter((a) => a.kind === 'docket')
  const documents = attachments.filter((a) => a.kind === 'document' || a.kind === 'pdf')

  const docketRows: DocketRow[] = dockets.map((a) => ({
    id: a.id,
    filename: a.filename,
    caption: a.caption,
    signedUrl: a.signedUrl,
    created_at: a.created_at,
    created_by_name: a.created_by_name,
    meta: a.meta as DocketRow['meta'],
  }))

  const codes: CostCodeOption[] = (costCodes ?? []).map((cc) => ({
    id: cc.id,
    code: cc.code,
    name: cc.name,
  }))

  return (
    <div className="flex flex-col gap-8">
      {/* Photos */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Photos</h2>
        {photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos yet.</p>
        ) : (
          <AttachmentList items={photos} canDelete={canDeleteAttachment} />
        )}
      </section>

      <div className="border-t" />

      {/* Dockets */}
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">Dockets</h2>
        <DocketTable
          rows={docketRows}
          parentType="project"
          parentId={id}
          costCodes={codes}
          canCreateCost={canCreateCost}
        />
      </section>

      <div className="border-t" />

      {/* Documents */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Documents</h2>
        </div>
        {canUpload && (
          <PhotoUpload
            parentType="project"
            parentId={id}
            kind="document"
            multiple
          />
        )}
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <AttachmentList items={documents} canDelete={canDeleteAttachment} />
        )}
      </section>
    </div>
  )
}
