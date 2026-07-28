import Link from 'next/link'
import { ChevronRightIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { permitUsage, type WasteUnit } from '@/lib/env'
import type { WasteClassification, WasteUnitKey } from '@/lib/zod'
import {
  WasteLoadsClient,
  type WasteLoadRow,
  type EnvTargetOption,
  type FacilityOption,
  type PermitOption,
} from './waste-loads-client'
import { AspectsSection, type AspectRow, type ObjectiveOption } from './aspects-section'
import {
  FacilitiesSection,
  type FacilityRow,
  type PermitRow,
  type ProjectOption,
} from './facilities-section'
import { WASTE_LOAD_SELECT, shapeLoadRow } from './load-queries'

export default async function WhsEnvPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')
  const canManage = profile.role === 'admin' || profile.role === 'office'
  const isAdmin = profile.role === 'admin'

  const supabase = await createClient()

  const [
    { data: loadRows },
    { data: facilityRows },
    { data: permitRows },
    { data: aspectRows },
    { data: projectRows },
    { data: jobRows },
    { data: objectiveRows },
  ] = await Promise.all([
    supabase
      .from('waste_loads')
      .select(WASTE_LOAD_SELECT)
      .order('date', { ascending: false })
      .order('number', { ascending: false }),
    supabase.from('env_facilities').select('*').order('name'),
    supabase
      .from('env_permits')
      .select('*, projects(number, name)')
      .order('created_at'),
    supabase
      .from('env_aspects')
      .select('*, objectives(number, title)')
      .order('significance', { ascending: false })
      .order('activity'),
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
      .from('objectives')
      .select('id, number, title')
      .eq('status', 'active')
      .order('number'),
  ])

  const loads: WasteLoadRow[] = (loadRows ?? []).map(shapeLoadRow)

  const projects: EnvTargetOption[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    label: `${p.number} — ${p.name}`,
  }))
  const jobs: EnvTargetOption[] = (jobRows ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number} — ${j.title}`,
  }))

  const facilities: FacilityRow[] = (facilityRows ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    licence_no: (f.licence_no as string | null) ?? null,
    licence_expiry: (f.licence_expiry as string | null) ?? null,
    waste_types: (f.waste_types as string | null) ?? null,
    active: Boolean(f.active),
    abn: (f.abn as string | null) ?? null,
    street_number: (f.street_number as string | null) ?? null,
    street_name: (f.street_name as string | null) ?? null,
    suburb: (f.suburb as string | null) ?? null,
    postcode: (f.postcode as string | null) ?? null,
    contact_name: (f.contact_name as string | null) ?? null,
    contact_number: (f.contact_number as string | null) ?? null,
    receives_regulated: Boolean(f.receives_regulated),
    agent_agreement_date: (f.agent_agreement_date as string | null) ?? null,
  }))
  const facilityOptions: FacilityOption[] = facilities
    .filter((f) => f.active)
    .map((f) => ({
      id: f.id,
      name: f.name,
      licence_expiry: f.licence_expiry,
      active: f.active,
    }))

  const permits: PermitRow[] = (permitRows ?? []).map((p) => {
    const project = p.projects as unknown as { number: string; name: string } | null
    const permitLoads = loads
      .filter((l) => l.permit_id === (p.id as string))
      .map((l) => ({ qty: l.qty, unit: l.unit as WasteUnit }))
    return {
      id: p.id as string,
      project_id: p.project_id as string,
      project_label: project ? `${project.number} — ${project.name}` : '—',
      reference: p.reference as string,
      description: (p.description as string | null) ?? null,
      classification: p.classification as WasteClassification,
      allowance_qty: Number(p.allowance_qty),
      allowance_unit: p.allowance_unit as WasteUnitKey,
      expiry: (p.expiry as string | null) ?? null,
      usage: permitUsage(
        Number(p.allowance_qty),
        p.allowance_unit as WasteUnit,
        permitLoads
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

  const aspects: AspectRow[] = (aspectRows ?? []).map((a) => {
    const objective = a.objectives as unknown as {
      number: string
      title: string
    } | null
    return {
      id: a.id as string,
      activity: a.activity as string,
      aspect: a.aspect as string,
      impact: a.impact as string,
      likelihood: Number(a.likelihood),
      severity: Number(a.severity),
      significance: Number(a.significance),
      significant: Boolean(a.significant),
      existing_controls: (a.existing_controls as string | null) ?? null,
      objective_id: (a.objective_id as string | null) ?? null,
      objective_label: objective ? `${objective.number} — ${objective.title}` : null,
    }
  })

  const objectives: ObjectiveOption[] = (objectiveRows ?? []).map((o) => ({
    id: o.id as string,
    label: `${o.number} — ${o.title}`,
  }))

  const projectOptions: ProjectOption[] = projects

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Environment"
        description="ISO 14001 operational core — aspects & impacts, waste/spoil load tracking with permit reconciliation, licensed facilities and monitoring (via field forms)."
      />

      {/* Trackable waste is a separate statutory record (Schedule 12) with its
          own 7-day clock and monthly bulk upload file. */}
      <Link
        href="/whs/env/regulated"
        className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors hover:bg-muted"
      >
        <div className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold">Regulated waste register</span>
          <span className="text-xs text-muted-foreground">
            Trackable waste movements, 7-day lodgement countdown and the monthly
            bulk upload file.
          </span>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </Link>

      <AspectsSection
        aspects={aspects}
        objectives={objectives}
        canManage={canManage}
        isAdmin={isAdmin}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Waste loads register</h2>
        <WasteLoadsClient
          loads={loads}
          projects={projects}
          jobs={jobs}
          facilities={facilityOptions}
          permits={permitOptions}
          canManage
        />
      </section>

      <FacilitiesSection
        facilities={facilities}
        permits={permits}
        projects={projectOptions}
        canManage={canManage}
        isAdmin={isAdmin}
      />
    </div>
  )
}
