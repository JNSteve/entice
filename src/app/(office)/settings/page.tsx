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
      .select('id, title, body, hazards, version, active')
      .order('title'),
    supabase
      .from('form_templates')
      .select('id, kind, name, description, schema, version, active, requires_signon')
      .order('name'),
    supabase
      .from('form_submissions')
      .select('template_id'),
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
      />
    </div>
  )
}
