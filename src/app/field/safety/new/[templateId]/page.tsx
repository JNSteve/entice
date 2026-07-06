import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  INCIDENT_TYPES,
  type FormField,
  type FormTemplateKind,
  type IncidentType,
} from '@/lib/zod'
import { FormRenderer, type TargetOption } from './form-renderer'

export default async function NewFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ templateId: string }>
  searchParams: Promise<{ project?: string; job?: string; type?: string }>
}) {
  const profile = await getProfile()
  if (!profile) redirect('/login')

  const { templateId } = await params
  const sp = await searchParams

  const supabase = await createClient()

  const { data: template } = await supabase
    .from('form_templates')
    .select('id, kind, name, description, schema, active, requires_signon')
    .eq('id', templateId)
    .single()
  if (!template || !template.active) notFound()

  const isPrestart = template.kind === 'prestart'

  const [{ data: projectRows }, { data: jobRows }, plantRes] = await Promise.all([
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
    isPrestart
      ? supabase.from('plant').select('id, name, rego').eq('active', true).order('name')
      : Promise.resolve({ data: null }),
  ])

  const projects: TargetOption[] = (projectRows ?? []).map((p) => ({
    id: p.id as string,
    label: `${p.number} — ${p.name}`,
  }))
  const jobs: TargetOption[] = (jobRows ?? []).map((j) => ({
    id: j.id as string,
    label: `${j.number} — ${j.title}`,
  }))
  const plantItems: TargetOption[] = (plantRes.data ?? []).map(
    (p: { id: string; name: string; rego: string | null }) => ({
      id: p.id,
      label: p.rego ? `${p.name} (${p.rego})` : p.name,
    })
  )

  // Preselect target from ?project= / ?job= when it matches an option.
  const defaultProjectId =
    sp.project && projects.some((p) => p.id === sp.project) ? sp.project : null
  const defaultJobId =
    !defaultProjectId && sp.job && jobs.some((j) => j.id === sp.job)
      ? sp.job
      : null
  // Prefill the incident type from ?type= (e.g. the monitoring-exceedance
  // "raise environmental incident" suggestion link).
  const defaultIncidentType =
    template.kind === 'incident' &&
    sp.type &&
    (INCIDENT_TYPES as readonly string[]).includes(sp.type)
      ? (sp.type as IncidentType)
      : null

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
        <h1 className="text-lg font-bold">{template.name}</h1>
        {template.description && (
          <p className="text-sm text-muted-foreground">{template.description}</p>
        )}
      </div>

      <FormRenderer
        template={{
          id: template.id as string,
          kind: template.kind as FormTemplateKind,
          schema: (template.schema as FormField[]) ?? [],
          requires_signon: Boolean(template.requires_signon),
        }}
        projects={projects}
        jobs={jobs}
        plantItems={plantItems}
        defaultProjectId={defaultProjectId}
        defaultJobId={defaultJobId}
        defaultIncidentType={defaultIncidentType}
      />
    </div>
  )
}
