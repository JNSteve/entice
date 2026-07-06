import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { fetchAuditFor, type AuditRow } from '@/lib/audit-queries'
import type { AttachmentItem } from '@/components/AttachmentList'
import {
  LotDetailClient,
  type LotDetailData,
  type LotHoldPointRow,
  type LotItemRow,
  type LotTestRow,
} from './lot-detail'
import type { ItpItemStatus, ItpPointType, LotStatus, LotTestType } from '@/lib/zod'

export default async function LotDetailPage({
  params,
}: {
  params: Promise<{ id: string; lotId: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id, lotId } = await params
  const supabase = await createClient()

  const { data: lot } = await supabase
    .from('lots')
    .select(
      `id, number, description, location, status, opened_on, closed_at,
       itp_instance_id, project_id,
       itp_instances(number, title, activity),
       closer:profiles!lots_closed_by_fkey(full_name),
       creator:profiles!lots_created_by_fkey(full_name)`
    )
    .eq('id', lotId)
    .eq('project_id', id)
    .single()

  if (!lot) notFound()

  const [
    { data: items },
    { data: inspections },
    { data: tests },
    { data: holdPoints },
    { data: verdict },
    attachments,
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('itp_instance_items')
      .select(
        'id, position, description, acceptance_criteria, spec_ref, point_type, record_required, responsible, status'
      )
      .eq('instance_id', lot.itp_instance_id as string)
      .order('position'),
    supabase
      .from('lot_inspections')
      .select(
        `id, itp_instance_item_id, result, notes, inspected_at, ncr_id,
         inspector:profiles!lot_inspections_inspected_by_fkey(full_name),
         ncrs(number, status)`
      )
      .eq('lot_id', lotId)
      .order('inspected_at', { ascending: false }),
    supabase
      .from('lot_test_results')
      .select(
        'id, test_type, description, value, uom, spec_min, spec_max, pass, lab_ref, tested_on, ncr_id, ncrs(number, status)'
      )
      .eq('lot_id', lotId)
      .order('created_at', { ascending: false }),
    supabase
      .from('hold_points')
      .select(
        'id, title, required_by, date, status, released_at, released_by, release_ref, itp_instance_item_id'
      )
      .eq('lot_id', lotId)
      .order('created_at'),
    supabase.rpc('lot_conformance', { p_lot: lotId }),
    fetchAttachmentsWithUrls(supabase, 'lot', lotId),
    fetchAuditFor(supabase, 'lots', lotId),
  ])

  const instance = lot.itp_instances as unknown as {
    number: string
    title: string
    activity: string
  } | null

  const lotData: LotDetailData = {
    id: lot.id as string,
    number: lot.number as string,
    description: lot.description as string,
    location: (lot.location as string | null) ?? null,
    status: lot.status as LotStatus,
    opened_on: lot.opened_on as string,
    closed_at: (lot.closed_at as string | null) ?? null,
    closed_by_name:
      (lot.closer as unknown as { full_name: string } | null)?.full_name ?? null,
    created_by_name:
      (lot.creator as unknown as { full_name: string } | null)?.full_name ?? null,
    itpNumber: instance?.number ?? '—',
    itpTitle: instance?.title ?? '—',
    itpActivity: instance?.activity ?? '—',
    conformance: (verdict as string | null) ?? 'open',
  }

  // Latest inspection per item for THIS lot (query is newest-first) — plus
  // the newest inspection carrying an NCR, so the disposition stays visible
  // after a passing re-inspection supersedes the failure.
  type InspectionRow = NonNullable<typeof inspections>[number]
  const latestByItem = new Map<string, InspectionRow>()
  const latestNcrByItem = new Map<string, InspectionRow>()
  for (const insp of inspections ?? []) {
    const key = insp.itp_instance_item_id as string
    if (!latestByItem.has(key)) latestByItem.set(key, insp)
    if (insp.ncr_id && !latestNcrByItem.has(key)) latestNcrByItem.set(key, insp)
  }

  const itemRows: LotItemRow[] = (items ?? []).map((it) => {
    const latest = latestByItem.get(it.id as string) ?? null
    const ncrInsp = latestNcrByItem.get(it.id as string) ?? null
    const ncr = ncrInsp?.ncrs as unknown as { number: string; status: string } | null
    return {
      id: it.id as string,
      position: it.position as number,
      description: it.description as string,
      acceptance_criteria: it.acceptance_criteria as string,
      spec_ref: (it.spec_ref as string | null) ?? null,
      point_type: it.point_type as ItpPointType,
      record_required: it.record_required as boolean,
      responsible: (it.responsible as string | null) ?? null,
      item_status: it.status as ItpItemStatus,
      latest: latest
        ? {
            inspection_id: latest.id as string,
            result: latest.result as 'pass' | 'fail',
            notes: (latest.notes as string | null) ?? null,
            inspected_at: latest.inspected_at as string,
            inspector_name:
              (latest.inspector as unknown as { full_name: string } | null)
                ?.full_name ?? null,
            ncr_id: (latest.ncr_id as string | null) ?? null,
            ncr_number: null,
            ncr_status: null,
          }
        : null,
      // Disposition trail: the newest inspection with a linked NCR (survives
      // a later passing re-inspection).
      ncr: ncrInsp
        ? {
            id: ncrInsp.ncr_id as string,
            number: ncr?.number ?? '—',
            status: ncr?.status ?? '—',
          }
        : null,
    }
  })

  const testRows: LotTestRow[] = (tests ?? []).map((t) => {
    const ncr = t.ncrs as unknown as { number: string; status: string } | null
    return {
      id: t.id as string,
      test_type: t.test_type as LotTestType,
      description: t.description as string,
      value: t.value === null ? null : Number(t.value),
      uom: (t.uom as string | null) ?? null,
      spec_min: t.spec_min === null ? null : Number(t.spec_min),
      spec_max: t.spec_max === null ? null : Number(t.spec_max),
      pass: t.pass as boolean,
      lab_ref: (t.lab_ref as string | null) ?? null,
      tested_on: (t.tested_on as string | null) ?? null,
      ncr_id: (t.ncr_id as string | null) ?? null,
      ncr_number: ncr?.number ?? null,
      ncr_status: ncr?.status ?? null,
    }
  })

  const holdPointRows: LotHoldPointRow[] = (holdPoints ?? []).map((hp) => ({
    id: hp.id as string,
    title: hp.title as string,
    required_by: hp.required_by as string,
    date: hp.date as string,
    status: hp.status as string,
    released_at: (hp.released_at as string | null) ?? null,
    released_by: (hp.released_by as string | null) ?? null,
    release_ref: (hp.release_ref as string | null) ?? null,
  }))

  const attachmentItems: AttachmentItem[] = attachments.map((a) => ({
    id: a.id,
    filename: a.filename,
    content_type: a.content_type,
    size: a.size,
    kind: a.kind,
    caption: a.caption,
    created_by: a.created_by,
    created_by_name: a.created_by_name,
    created_at: a.created_at,
    signedUrl: a.signedUrl,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/projects/${id}/quality`}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Quality
      </Link>
      <LotDetailClient
        projectId={id}
        lot={lotData}
        items={itemRows}
        tests={testRows}
        holdPoints={holdPointRows}
        attachments={attachmentItems}
        auditHistory={auditHistory as AuditRow[]}
        role={profile.role}
      />
    </div>
  )
}
