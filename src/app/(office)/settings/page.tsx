import { createClient } from '@/lib/supabase/server'
import { requireRole } from '@/lib/auth'
import { PageHeader } from '@/components/PageHeader'
import { SettingsTabs, type SettingsTab } from './settings-tabs'

const VALID_TABS: SettingsTab[] = [
  'company',
  'users',
  'rates',
  'cost-codes',
  'plant',
  'checklists',
  'swms',
  'whs-forms',
  'competencies',
  'backup',
  'errors',
  'security',
  'itp',
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
  ] = await Promise.all([
    supabase.from('settings').select('*').eq('id', 1).single(),
    supabase
      .from('profiles')
      .select('id, full_name, role, phone, hourly_cost, active')
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
        competencyTypes={competencyTypes ?? []}
        roleRequirements={roleRequirements ?? []}
        backupRuns={backupRuns ?? []}
        appErrors={appErrors ?? []}
        accessReviews={accessReviewRows}
        reviewers={reviewers}
        itpTemplates={itpTemplates ?? []}
        itpTemplateItems={itpTemplateItems ?? []}
      />
    </div>
  )
}
