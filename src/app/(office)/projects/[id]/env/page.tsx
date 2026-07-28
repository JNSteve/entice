import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FileTextIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { fmtDate } from '@/lib/format'
import { expiryColour } from '@/lib/compliance'
import { cn } from '@/lib/utils'
import {
  permitUsageWithMovements,
  type BudfPermitUnit,
  type WasteUnit,
} from '@/lib/env'
import {
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import {
  WasteLoadsClient,
  type WasteLoadRow,
  type EnvTargetOption,
  type FacilityOption,
  type PermitOption,
} from '@/app/(office)/whs/env/waste-loads-client'
import { PermitUsageBar } from '@/app/(office)/whs/env/facilities-section'
import {
  WASTE_LOAD_SELECT,
  shapeLoadRow,
} from '@/app/(office)/whs/env/load-queries'

export default async function ProjectEnvPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: loadRows },
    { data: permitRows },
    { data: facilityRows },
    { data: movementRows },
  ] = await Promise.all([
    supabase.from('projects').select('id, number, name').eq('id', id).single(),
    supabase
      .from('waste_loads')
      .select(WASTE_LOAD_SELECT)
      .eq('project_id', id)
      .order('date', { ascending: false })
      .order('number', { ascending: false }),
    supabase.from('env_permits').select('*').eq('project_id', id).order('created_at'),
    supabase
      .from('env_facilities')
      .select('id, name, licence_expiry, active')
      .eq('active', true)
      .order('name'),
    // Tracked movements count against the same allowances — one physical load
    // is one record, so the two tables never double-count each other.
    supabase
      .from('regulated_waste_movements')
      .select('permit_id, waste_amount, waste_unit')
      .eq('project_id', id),
  ])

  if (!project) notFound()

  const loads: WasteLoadRow[] = (loadRows ?? []).map(shapeLoadRow)

  const facilities: FacilityOption[] = (facilityRows ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    licence_expiry: (f.licence_expiry as string | null) ?? null,
    active: Boolean(f.active),
  }))

  const permits = (permitRows ?? []).map((p) => {
    const permitLoads = loads
      .filter((l) => l.permit_id === (p.id as string))
      .map((l) => ({ qty: l.qty, unit: l.unit as WasteUnit }))
    const permitMovements = (movementRows ?? [])
      .filter((mv) => mv.permit_id === (p.id as string))
      .map((mv) => ({
        qty: Number(mv.waste_amount),
        unit: mv.waste_unit as BudfPermitUnit,
      }))
    return {
      id: p.id as string,
      project_id: p.project_id as string,
      reference: p.reference as string,
      description: (p.description as string | null) ?? null,
      classification: p.classification as WasteClassification,
      allowance_qty: Number(p.allowance_qty),
      allowance_unit: p.allowance_unit as WasteUnitKey,
      expiry: (p.expiry as string | null) ?? null,
      usage: permitUsageWithMovements(
        Number(p.allowance_qty),
        p.allowance_unit as WasteUnit,
        permitLoads,
        permitMovements
      ),
    }
  })

  const permitOptions: PermitOption[] = permits.map((p) => ({
    id: p.id,
    project_id: p.project_id,
    reference: p.reference,
    classification: p.classification,
    allowance_qty: p.allowance_qty,
    allowance_unit: p.allowance_unit,
    expiry: p.expiry,
  }))

  const lockedProject: EnvTargetOption = {
    id: project.id as string,
    label: `${project.number} — ${project.name}`,
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Permit reconciliation */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">Permit reconciliation</h2>
            <p className="text-sm text-muted-foreground">
              Loads booked against each permit allowance. Company-wide facilities
              and permits live on the{' '}
              <Link
                href="/whs/env"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Environment register
              </Link>
              .
            </p>
          </div>
          {permits.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              render={
                <a
                  href={`/api/pdf/waste-reconciliation/${project.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <FileTextIcon className="size-4" />
              Reconciliation PDF
            </Button>
          )}
        </div>

        {permits.length === 0 ? (
          <div className="rounded-lg border px-4 py-3 text-sm text-muted-foreground">
            No permits recorded for this project — add the disposal allowances
            (RAP volumes, EA conditions) on the Environment register so loads
            reconcile against them.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {permits.map((p) => (
              <div
                key={p.id}
                className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">
                    {p.reference}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {WASTE_CLASSIFICATION_LABELS[p.classification]} · allowance{' '}
                    {p.allowance_qty} {WASTE_UNIT_LABELS[p.allowance_unit]}
                    {p.expiry ? (
                      <>
                        {' · expires '}
                        <span className={cn(expiryColour(p.expiry))}>
                          {fmtDate(p.expiry)}
                        </span>
                      </>
                    ) : null}
                  </span>
                  {p.usage.otherUnitCount > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      +{p.usage.otherUnitCount} load
                      {p.usage.otherUnitCount === 1 ? '' : 's'} recorded in the
                      other unit (not converted)
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                    {p.usage.used} / {p.allowance_qty}{' '}
                    {WASTE_UNIT_LABELS[p.allowance_unit]}
                  </span>
                  <div className="w-48">
                    <PermitUsageBar usage={p.usage} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Loads for this project */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Waste loads</h2>
        <WasteLoadsClient
          loads={loads}
          projects={[]}
          jobs={[]}
          facilities={facilities}
          permits={permitOptions}
          lockedProject={lockedProject}
          canManage
        />
      </section>
    </div>
  )
}
