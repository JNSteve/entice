import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { VariationsTable, type VariationRow } from './variations-table'
import { NewVariationDialog } from './variation-dialog'
import type { AttachmentItem } from '@/components/AttachmentList'

export default async function ProjectVariationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: variations }] = await Promise.all([
    supabase.from('projects').select('id').eq('id', id).single(),
    supabase
      .from('variations')
      .select(
        'id, number, title, description, status, cost_estimate, sell_amount, client_ref, time_bar_date, submitted_at, decided_at, notes'
      )
      .eq('project_id', id)
      .order('number', { ascending: true }),
  ])

  if (!project) notFound()

  const rows: VariationRow[] = (variations ?? []).map((v) => ({
    id: v.id,
    number: v.number,
    title: v.title,
    description: v.description ?? null,
    status: v.status,
    cost_estimate: v.cost_estimate != null ? Number(v.cost_estimate) : null,
    sell_amount: v.sell_amount != null ? Number(v.sell_amount) : null,
    client_ref: v.client_ref ?? null,
    time_bar_date: v.time_bar_date ?? null,
    submitted_at: v.submitted_at ?? null,
    decided_at: v.decided_at ?? null,
    notes: v.notes ?? null,
  }))

  // Fetch attachments for all variations
  const attachmentsByVariation: Record<string, AttachmentItem[]> = {}
  await Promise.all(
    rows.map(async (v) => {
      attachmentsByVariation[v.id] = await fetchAttachmentsWithUrls(supabase, 'variation', v.id)
    })
  )

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Variations register</h2>
        <NewVariationDialog projectId={id} />
      </div>
      <VariationsTable
        projectId={id}
        variations={rows}
        attachmentsByVariation={attachmentsByVariation}
      />
    </section>
  )
}
