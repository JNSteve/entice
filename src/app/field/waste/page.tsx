import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fmtDate } from '@/lib/format'
import {
  WASTE_CLASSIFICATION_LABELS,
  WASTE_UNIT_LABELS,
  type WasteClassification,
  type WasteUnitKey,
} from '@/lib/zod'
import {
  FieldWasteForm,
  type TargetOption,
  type FieldFacilityOption,
} from './waste-form'

export default async function FieldWastePage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const sp = await searchParams
  const supabase = await createClient()

  const [{ data: projectRows }, { data: jobRows }, { data: facilityRows }, { data: myLoads }] =
    await Promise.all([
      supabase
        .from('projects')
        .select('id, number, name')
        .eq('archived', false)
        .neq('status', 'closed')
        .order('number'),
      supabase
        .from('jobs')
        .select('id, number, title')
        .eq('archived', false)
        .not('status', 'in', '("invoiced","paid","lost")')
        .order('number'),
      supabase
        .from('env_facilities')
        .select('id, name, licence_expiry, active')
        .eq('active', true)
        .order('name'),
      // RLS scopes field users to loads they created or on assigned projects.
      supabase
        .from('waste_loads')
        .select('id, number, date, classification, qty, unit')
        .order('created_at', { ascending: false })
        .limit(5),
    ])

  const projects: TargetOption[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    label: `${p.number} — ${p.name}`,
  }))
  const jobs: TargetOption[] = (jobRows ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number} — ${j.title}`,
  }))
  const facilities: FieldFacilityOption[] = (facilityRows ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    licence_expiry: (f.licence_expiry as string | null) ?? null,
    active: Boolean(f.active),
  }))

  const defaultProjectId =
    sp.project && projects.some((p) => p.id === sp.project) ? sp.project : null

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link
          href="/field/safety"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-3.5" />
          Safety
        </Link>
        <h1 className="text-lg font-bold">Log waste load</h1>
        <p className="text-sm text-muted-foreground">
          Record every load leaving site and photograph the docket — waste
          tracking is an ISO 14001 record.
        </p>
      </div>

      <FieldWasteForm
        projects={projects}
        jobs={jobs}
        facilities={facilities}
        defaultProjectId={defaultProjectId}
      />

      {(myLoads ?? []).length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            My recent loads
          </h2>
          <div className="flex flex-col divide-y rounded-xl border">
            {(myLoads ?? []).map((l) => (
              <div
                key={l.id as string}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="font-mono text-sm font-medium">
                    {l.number as string}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {WASTE_CLASSIFICATION_LABELS[
                      l.classification as WasteClassification
                    ]}{' '}
                    · {Number(l.qty)}{' '}
                    {WASTE_UNIT_LABELS[l.unit as WasteUnitKey]}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {fmtDate(l.date as string)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
