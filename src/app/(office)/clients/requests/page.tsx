import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import { PageHeader } from '@/components/PageHeader'
import { RequestsRegister, type OfficeRequestRow } from './requests-register'

/**
 * Portal work-request register — every request clients raise through their
 * portal links, filterable by status, with a detail drawer (photos, urgency,
 * thread link) and the convert-to-quote action. Admin/office manage;
 * supervisors read-only (no photos — signing storage URLs needs bucket read,
 * which supervisors lack for this prefix).
 */
export default async function RequestsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const canManage = profile.role === 'admin' || profile.role === 'office'

  const supabase = await createClient()

  const { data: requests } = await supabase
    .from('portal_requests')
    .select(
      `id, number, title, description, urgency, status, photo_paths, created_at,
       client_id, site_id, quote_id, scheduled_for, scheduled_note,
       compliance_item_id, property_compliance_items(title, kind),
       clients(name), sites(name), quotes(number)`
    )
    .order('created_at', { ascending: false })

  // Batch-sign every photo (1h office links) — requests are low-volume.
  const allPaths = (requests ?? []).flatMap((r) => (r.photo_paths as string[]) ?? [])
  const urlByPath = new Map<string, string>()
  if (canManage && allPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from('attachments')
      .createSignedUrls(allPaths, 3600)
    for (const entry of signed ?? []) {
      if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
    }
  }

  const rows: OfficeRequestRow[] = (requests ?? []).map((r) => {
    const client = r.clients as unknown as { name: string } | null
    const site = r.sites as unknown as { name: string } | null
    const quote = r.quotes as unknown as { number: string } | null
    const item = r.property_compliance_items as unknown as {
      title: string
      kind: string
    } | null
    return {
      renewal_of: item
        ? `${PROPERTY_COMPLIANCE_KIND_LABELS[item.kind as PropertyComplianceKind] ?? item.kind} — ${item.title}`
        : null,
      id: r.id as string,
      number: r.number as string,
      title: r.title as string,
      description: r.description as string,
      urgency: r.urgency as string,
      status: r.status as string,
      created_at: r.created_at as string,
      client_id: r.client_id as string,
      client_name: client?.name ?? '—',
      site_id: r.site_id as string,
      site_name: site?.name ?? '—',
      quote_id: (r.quote_id as string | null) ?? null,
      quote_number: quote?.number ?? null,
      scheduled_for: (r.scheduled_for as string | null) ?? null,
      scheduled_note: (r.scheduled_note as string | null) ?? null,
      photos: (((r.photo_paths as string[]) ?? [])
        .map((p) => urlByPath.get(p))
        .filter(Boolean) ?? []) as string[],
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Work requests"
        description="Requests raised by clients through their portal links."
      />
      <RequestsRegister requests={rows} canManage={canManage} />
    </div>
  )
}
