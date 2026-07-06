import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangleIcon, ArrowLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAttachmentsWithUrls } from '@/lib/attachment-queries'
import { fetchAuditFor } from '@/lib/audit-queries'
import { AttachmentList } from '@/components/AttachmentList'
import { AuditHistory } from '@/components/AuditHistory'
import { PhotoUpload } from '@/components/PhotoUpload'
import { fmtDate } from '@/lib/format'
import {
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import { WASTE_LOAD_SELECT, shapeLoadRow } from '../../load-queries'
import {
  DeleteWasteLoadButton,
  EditWasteLoadButton,
  type EnvTargetOption,
  type FacilityOption,
  type PermitOption,
} from '../../waste-loads-client'

export default async function WasteLoadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const isAdmin = profile.role === 'admin'

  const { id } = await params
  const supabase = await createClient()

  const { data: raw } = await supabase
    .from('waste_loads')
    .select(WASTE_LOAD_SELECT)
    .eq('id', id)
    .single()
  if (!raw) notFound()

  const load = shapeLoadRow(raw)

  const [
    attachments,
    auditRows,
    { data: projectRows },
    { data: jobRows },
    { data: facilityRows },
    { data: permitRows },
    { data: permitLoadRows },
  ] = await Promise.all([
    fetchAttachmentsWithUrls(supabase, 'waste_load', id),
    fetchAuditFor(supabase, 'waste_loads', id),
    supabase
      .from('projects')
      .select('id, number, name')
      .neq('status', 'closed')
      .order('number'),
    supabase
      .from('jobs')
      .select('id, number, title')
      .not('status', 'in', '("invoiced","paid","lost")')
      .order('number'),
    supabase
      .from('env_facilities')
      .select('id, name, licence_expiry, active')
      .eq('active', true)
      .order('name'),
    supabase.from('env_permits').select('*').order('created_at'),
    // Loads on the same permit — feeds the gating check in the edit dialog.
    load.permit_id
      ? supabase
          .from('waste_loads')
          .select(WASTE_LOAD_SELECT)
          .eq('permit_id', load.permit_id)
      : Promise.resolve({ data: [] }),
  ])

  const projects: EnvTargetOption[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    label: `${p.number} — ${p.name}`,
  }))
  const jobs: EnvTargetOption[] = (jobRows ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number} — ${j.title}`,
  }))
  const facilities: FacilityOption[] = (facilityRows ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    licence_expiry: (f.licence_expiry as string | null) ?? null,
    active: Boolean(f.active),
  }))
  const permits: PermitOption[] = (permitRows ?? []).map((p) => ({
    id: p.id as string,
    project_id: p.project_id as string,
    reference: p.reference as string,
    classification: p.classification as WasteClassification,
    allowance_qty: Number(p.allowance_qty),
    allowance_unit: p.allowance_unit as WasteUnitKey,
    expiry: (p.expiry as string | null) ?? null,
  }))
  const permitLoads = (permitLoadRows ?? []).map(shapeLoadRow)

  const fields: { label: string; value: React.ReactNode }[] = [
    { label: 'Date', value: fmtDate(load.date) },
    { label: 'Project / job', value: load.target_label },
    {
      label: 'Classification',
      value: `${WASTE_CLASSIFICATION_LABELS[load.classification]}${
        load.classification_detail ? ` — ${load.classification_detail}` : ''
      }`,
    },
    { label: 'Quantity', value: `${load.qty} ${WASTE_UNIT_LABELS[load.unit]}` },
    { label: 'Receiving facility', value: load.facility_name ?? '—' },
    { label: 'Permit', value: load.permit_ref ?? '—' },
    { label: 'Transporter', value: load.transporter ?? '—' },
    { label: 'Docket reference', value: load.docket_ref ?? '—' },
    { label: 'Logged by', value: load.created_by_name ?? '—' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link
            href="/whs/env"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Environment
          </Link>
          <h1 className="font-mono text-xl font-semibold">{load.number}</h1>
          <p className="text-sm text-muted-foreground">
            Waste load record — ISO 14001 8.1 / 9.1
          </p>
        </div>
        <div className="flex items-center gap-2">
          <EditWasteLoadButton
            load={load}
            projects={projects}
            jobs={jobs}
            facilities={facilities}
            permits={permits}
            allLoads={permitLoads}
          />
          {isAdmin && <DeleteWasteLoadButton loadId={load.id} />}
        </div>
      </div>

      {load.override_reason && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-amber-800 dark:text-amber-200">
              Logged with a gating override
            </span>
            <span className="text-amber-800 dark:text-amber-200">
              {load.override_reason}
            </span>
          </div>
        </div>
      )}

      <section className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {f.label}
            </span>
            <span className="text-sm">{f.value}</span>
          </div>
        ))}
        {load.notes && (
          <div className="flex flex-col gap-0.5 sm:col-span-2 lg:col-span-3">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Notes
            </span>
            <span className="whitespace-pre-wrap text-sm">{load.notes}</span>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Docket &amp; photos
        </h2>
        <PhotoUpload parentType="waste_load" parentId={load.id} kind="docket" multiple />
        {attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No docket attached yet — photograph the weighbridge/tipping docket.
          </p>
        ) : (
          <AttachmentList items={attachments} canDelete />
        )}
      </section>

      <AuditHistory rows={auditRows} />
    </div>
  )
}
