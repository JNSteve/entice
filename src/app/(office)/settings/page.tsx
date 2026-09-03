import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import {
  DEFAULT_PRICING,
  quoteTemplateSchema,
  starterDoc,
  type QuoteTemplateRow,
} from '@/lib/quote-doc'
import { SettingsTabs, type SettingsTab } from './settings-tabs'

// Quote-template PDF import (OpenAI reading a whole quote) can run past the
// default serverless window — give actions invoked from this page headroom.
export const maxDuration = 300

const VALID_TABS: SettingsTab[] = [
  'company',
  'users',
  'rates',
  'cost-codes',
  'plant',
  'checklists',
  'swms',
  'whs-forms',
  'estimating',
  'quote-templates',
  'competencies',
  'backup',
  'errors',
  'security',
  'itp',
  'email',
  'archive',
]

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const initialTab: SettingsTab = VALID_TABS.includes(tab as SettingsTab)
    ? (tab as SettingsTab)
    : 'company'

  const [caller, supabase] = await Promise.all([
    requireRole('admin'),
    createClient(),
  ])

  const [
    { data: settings },
    { data: profiles },
    { data: rateItems },
    { data: costCodes },
    { data: plant },
    { data: checklists },
    { data: swmsTemplates },
    { data: rawFormTemplates },
    { data: submissionCounts },
    { data: competencyTypes },
    { data: roleRequirements },
    { data: backupRuns },
    { data: appErrors },
    { data: accessReviews },
    { data: itpTemplates },
    { data: itpTemplateItems },
    { data: emailLog },
    { data: takeoffAssemblies },
    { data: takeoffComponents },
    { data: quoteTemplates },
    { data: archivedQuotes },
    { data: archivedJobs },
    { data: archivedProjects },
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single(),
    supabase
      .from('profiles')
      .select('id, full_name, role, phone, position, hourly_cost, active')
      .order('full_name'),
    supabase
      .from('rate_items')
      .select('id, kind, name, unit, cost, default_markup_pct, active')
      .order('kind')
      .order('name'),
    supabase
      .from('cost_codes')
      .select('id, code, name, category, active')
      .order('code'),
    supabase
      .from('plant')
      .select('id, name, type, rego, ownership, hourly_rate, active')
      .order('name'),
    supabase
      .from('checklist_templates')
      .select('id, title, items, created_at')
      .order('title'),
    supabase
      .from('swms_templates')
      .select(
        'id, title, body, hazards, version, active, doc_control, hrcw_items, requirements, steps, stop_work_triggers, emergency_scenarios, references_list'
      )
      .order('title'),
    supabase
      .from('form_templates')
      .select('id, kind, name, description, schema, version, active, requires_signon')
      .order('name'),
    supabase
      .from('form_submissions')
      .select('template_id'),
    supabase
      .from('competency_types')
      .select('id, name, category, validity_months, is_system, active')
      .order('name'),
    supabase
      .from('role_competency_requirements')
      .select('id, role, competency_type_id, is_mandatory'),
    supabase
      .from('backup_runs')
      .select(
        'id, started_at, finished_at, status, tables_count, rows_total, storage_objects_count, storage_bytes_mirrored, export_bytes, path, error, trigger'
      )
      .order('started_at', { ascending: false })
      .limit(30),
    supabase
      .from('app_errors')
      .select('id, at, source, path, message, stack, user_role, resolved')
      .order('at', { ascending: false })
      .limit(100),
    supabase
      .from('access_reviews')
      .select(
        'id, number, reviewed_on, findings, actions, next_review_due, reviewer:profiles!access_reviews_reviewer_id_fkey(full_name)'
      )
      .order('reviewed_on', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('itp_templates')
      .select('id, name, activity, discipline, active')
      .order('name'),
    supabase
      .from('itp_template_items')
      .select(
        'id, template_id, position, description, acceptance_criteria, spec_ref, point_type, record_required, responsible'
      )
      .order('template_id')
      .order('position'),
    supabase
      .from('email_log')
      .select('id, to_address, subject, template, status, entity_kind, error, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('takeoff_assemblies')
      .select('id, name, unit, description, active')
      .order('name'),
    supabase
      .from('takeoff_assembly_components')
      .select('id, assembly_id, description, unit, factor, fixed_qty, rate_item_id, position')
      .order('assembly_id')
      .order('position'),
    supabase
      .from('quote_templates')
      .select(
        'id, name, doc_title, heading, validity_text, number_headings, blocks, pricing_defaults, is_default, active, source_path, source_filename, updated_at'
      )
      .order('name'),
    supabase
      .from('quotes')
      .select('id, number, title, archived_at, clients(name)')
      .eq('archived', true)
      .order('archived_at', { ascending: false }),
    supabase
      .from('jobs')
      .select('id, number, title, archived_at, clients(name)')
      .eq('archived', true)
      .order('archived_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, number, name, archived_at, clients(name)')
      .eq('archived', true)
      .order('archived_at', { ascending: false }),
  ])

  // Build per-template submission counts
  const countMap = new Map<string, number>()
  for (const row of submissionCounts ?? []) {
    const id = (row as { template_id: string }).template_id
    countMap.set(id, (countMap.get(id) ?? 0) + 1)
  }

  const formTemplates = (rawFormTemplates ?? []).map((t) => ({
    ...t,
    submission_count: countMap.get(t.id) ?? 0,
  }))

  const accessReviewRows = (accessReviews ?? []).map((r) => ({
    id: r.id as string,
    number: r.number as string,
    reviewed_on: r.reviewed_on as string,
    reviewer_name:
      (r.reviewer as unknown as { full_name: string } | null)?.full_name ?? null,
    findings: r.findings as string,
    actions: (r.actions as string | null) ?? null,
    next_review_due: r.next_review_due as string,
  }))

  const reviewers = (profiles ?? [])
    .filter((p) => p.active)
    .map((p) => ({ id: p.id, full_name: p.full_name }))

  // Group takeoff components under their assembly (both already ordered).
  const componentsByAssembly = new Map<
    string,
    {
      id: string
      description: string
      unit: string
      factor: number
      fixed_qty: number | null
      rate_item_id: string | null
    }[]
  >()
  for (const c of takeoffComponents ?? []) {
    const list = componentsByAssembly.get(c.assembly_id) ?? []
    list.push({
      id: c.id,
      description: c.description,
      unit: c.unit,
      factor: Number(c.factor),
      fixed_qty: c.fixed_qty == null ? null : Number(c.fixed_qty),
      rate_item_id: c.rate_item_id,
    })
    componentsByAssembly.set(c.assembly_id, list)
  }

  const assemblies = (takeoffAssemblies ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    unit: a.unit,
    description: a.description,
    active: a.active,
    components: componentsByAssembly.get(a.id) ?? [],
  }))

  const rateOptions = (rateItems ?? [])
    .filter((r) => r.active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      cost: Number(r.cost),
    }))

  // Coerced through the schema so malformed template JSON never reaches the
  // client. A row that fails validation stays visible, flagged `invalid`, with
  // starter content so an admin can rebuild (edit + save) or deactivate it.
  const quoteTemplateRows: QuoteTemplateRow[] = (quoteTemplates ?? []).map((t) => {
    const base = {
      id: t.id as string,
      is_default: Boolean(t.is_default),
      active: Boolean(t.active),
      updated_at: t.updated_at as string,
    }
    const parsed = quoteTemplateSchema.safeParse(t)
    if (parsed.success) return { ...parsed.data, ...base }
    console.error(`quote_templates row ${t.id} failed validation:`, parsed.error.issues[0]?.message)
    return {
      ...starterDoc(),
      name: typeof t.name === 'string' && t.name ? t.name : 'Untitled template',
      doc_title: typeof t.doc_title === 'string' && t.doc_title ? t.doc_title : 'Quotation',
      heading: typeof t.heading === 'string' ? t.heading : null,
      pricing_defaults: DEFAULT_PRICING,
      source_path: (t.source_path as string | null) ?? null,
      source_filename: (t.source_filename as string | null) ?? null,
      ...base,
      invalid: true,
    }
  })

  const clientName = (row: { clients: unknown }) =>
    (row.clients as { name: string } | null)?.name ?? null

  const archivedQuoteRows = (archivedQuotes ?? []).map((r) => ({
    id: r.id as string,
    number: r.number as string,
    title: r.title as string,
    client_name: clientName(r),
    archived_at: (r.archived_at as string | null) ?? null,
  }))

  const archivedJobRows = (archivedJobs ?? []).map((r) => ({
    id: r.id as string,
    number: r.number as string,
    title: r.title as string,
    client_name: clientName(r),
    archived_at: (r.archived_at as string | null) ?? null,
  }))

  const archivedProjectRows = (archivedProjects ?? []).map((r) => ({
    id: r.id as string,
    number: r.number as string,
    title: r.name as string,
    client_name: clientName(r),
    archived_at: (r.archived_at as string | null) ?? null,
  }))

  return (
    <div className="flex flex-col gap-2">
      <PageHeader
        title="Settings"
        description="Company details, users, rates and master data."
      />
      <SettingsTabs
        initialTab={initialTab}
        settings={settings}
        profiles={profiles ?? []}
        currentUserId={caller.id}
        rateItems={rateItems ?? []}
        costCodes={costCodes ?? []}
        plant={plant ?? []}
        checklists={checklists ?? []}
        swmsTemplates={swmsTemplates ?? []}
        formTemplates={formTemplates}
        assemblies={assemblies}
        rateOptions={rateOptions}
        quoteTemplates={quoteTemplateRows}
        templateImportEnabled={Boolean(process.env.OPENAI_API_KEY)}
        competencyTypes={competencyTypes ?? []}
        roleRequirements={roleRequirements ?? []}
        backupRuns={backupRuns ?? []}
        appErrors={appErrors ?? []}
        accessReviews={accessReviewRows}
        reviewers={reviewers}
        itpTemplates={itpTemplates ?? []}
        itpTemplateItems={itpTemplateItems ?? []}
        emailLog={emailLog ?? []}
        emailKeyPresent={Boolean(process.env.RESEND_API_KEY?.trim())}
        emailFromPresent={Boolean(process.env.EMAIL_FROM?.trim())}
        archivedQuotes={archivedQuoteRows}
        archivedJobs={archivedJobRows}
        archivedProjects={archivedProjectRows}
      />
    </div>
  )
}
