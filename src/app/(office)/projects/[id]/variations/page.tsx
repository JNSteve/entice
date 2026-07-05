import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsForParents } from '@/lib/attachment-queries'
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
        'id, number, title, description, status, cost_estimate, sell_amount, client_ref, time_bar_date, submitted_at, decided_at, notes, portal_published'
      )
      .eq('project_id', id)
      .order('number', { ascending: true }),
  ])

  if (!project) notFound()

  // Sign-on-the-glass evidence for this project's variations (accept wins).
  const variationIds = (variations ?? []).map((v) => v.id as string)
  const { data: acceptances } =
    variationIds.length > 0
      ? await supabase
          .from('portal_acceptances')
          .select('target_id, action, signer_name, signature_data, reason, signed_at')
          .eq('kind', 'variation')
          .in('target_id', variationIds)
          .order('signed_at', { ascending: false })
      : { data: [] }
  const acceptanceByVariation = new Map<string, NonNullable<typeof acceptances>[number]>()
  for (const a of acceptances ?? []) {
    const key = a.target_id as string
    const existing = acceptanceByVariation.get(key)
    if (!existing || (existing.action !== 'accepted' && a.action === 'accepted')) {
      acceptanceByVariation.set(key, a)
    }
  }

  const rows: VariationRow[] = (variations ?? []).map((v) => {
    const acceptance = acceptanceByVariation.get(v.id as string) ?? null
    return {
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
      portal_published: Boolean(v.portal_published),
      portal_acceptance: acceptance
        ? {
            action: acceptance.action as 'accepted' | 'declined',
            signer_name: acceptance.signer_name as string,
            signed_display: new Date(acceptance.signed_at as string).toLocaleString(
              'en-AU',
              {
                timeZone: 'Australia/Brisbane',
                dateStyle: 'medium',
                timeStyle: 'short',
              }
            ),
            signature_data: (acceptance.signature_data as string | null) ?? null,
            reason: (acceptance.reason as string | null) ?? null,
          }
        : null,
    }
  })

  // Fetch attachments for all variations (one select + one signed-URL batch)
  const attachmentsByVariation: Record<string, AttachmentItem[]> =
    await fetchAttachmentsForParents(
      supabase,
      'variation',
      rows.map((v) => v.id)
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
