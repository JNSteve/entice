import { createClient } from '@/lib/supabase/server'
import { FormsRegister } from './forms-register'
import type { FormField, FormTemplateKind } from '@/lib/zod'

export default async function WhsFormsPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string
    project_id?: string
    person_id?: string
    from?: string
    to?: string
    highlight?: string
  }>
}) {
  const { kind, project_id, person_id, from, to, highlight } = await searchParams
  const supabase = await createClient()

  // Build base query for submissions
  let query = supabase
    .from('form_submissions')
    .select(
      `id, kind, template_id, template_version, submitted_at, data, schema_snapshot,
       projects(id, number, name),
       jobs(id, number, title),
       plant(id, name),
       profiles!form_submissions_submitted_by_fkey(id, full_name),
       form_templates(id, name, requires_signon),
       form_signons(id, profile_id)`
    )
    .order('submitted_at', { ascending: false })
    .limit(500)

  // Filters
  if (kind && kind !== 'all') {
    query = query.eq('kind', kind)
  }
  if (project_id) {
    query = query.eq('project_id', project_id)
  }
  if (person_id) {
    query = query.eq('submitted_by', person_id)
  }
  if (from) {
    query = query.gte('submitted_at', from + 'T00:00:00')
  }
  if (to) {
    query = query.lte('submitted_at', to + 'T23:59:59')
  }

  const { data: submissions } = await query

  // Fetch projects for filter dropdown (active/recent)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, number, name')
    .eq('archived', false)
    .in('status', ['active', 'practical_completion', 'defects_liability'])
    .order('number')

  // Fetch profiles for person filter
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('active', true)
    .order('full_name')

  // Shape rows for the register component
  const rows = (submissions ?? []).map((s) => {
    const projectRel = s.projects as unknown as { id: string; number: string; name: string } | null
    const jobRel = s.jobs as unknown as { id: string; number: string; title: string } | null
    const plantRel = s.plant as unknown as { id: string; name: string } | null
    const profileRel = s.profiles as unknown as { id: string; full_name: string } | null
    const templateRel = s.form_templates as unknown as { id: string; name: string; requires_signon: boolean } | null
    const signons = s.form_signons as unknown as { id: string; profile_id: string | null }[]

    const signonCount = signons?.length ?? 0
    const externalCount = (signons ?? []).filter((sg) => sg.profile_id === null).length

    return {
      id: s.id,
      kind: s.kind as FormTemplateKind,
      templateId: s.template_id,
      templateName: templateRel?.name ?? '—',
      templateVersion: s.template_version,
      requiresSignon: templateRel?.requires_signon ?? false,
      submittedAt: s.submitted_at,
      project: projectRel ?? null,
      job: jobRel ?? null,
      plant: plantRel ?? null,
      submittedBy: profileRel?.full_name ?? '—',
      signonCount,
      externalCount,
      data: (s.data ?? {}) as Record<string, unknown>,
      schemaSnapshot: (s.schema_snapshot as FormField[] | null) ?? null,
    }
  })

  return (
    <FormsRegister
      rows={rows}
      projects={(projects ?? []).map((p) => ({ id: p.id, number: p.number, name: p.name }))}
      profiles={(profiles ?? []).map((p) => ({ id: p.id, full_name: p.full_name }))}
      filters={{
        kind: kind ?? 'all',
        project_id: project_id ?? '',
        person_id: person_id ?? '',
        from: from ?? '',
        to: to ?? '',
      }}
      highlight={highlight ?? null}
    />
  )
}
