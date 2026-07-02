import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { todayAU } from '@/lib/tz'
import { PageHeader } from '@/components/PageHeader'
import {
  AuditsRegister,
  type AuditRow,
  type ProgrammeRow,
  type AreaOption,
  type ProfileOption,
  type TemplateOption,
} from './audits-table'
import type { AuditStandard, AuditStatus, AuditProgrammeStatus } from '@/lib/zod'

export default async function WhsAuditsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const today = todayAU()

  const [
    { data: programmes },
    { data: audits },
    { data: findings },
    { data: areas },
    { data: profileRows },
    { data: templates },
  ] = await Promise.all([
    supabase
      .from('audit_programmes')
      .select('id, year, title, status, notes')
      .order('year', { ascending: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('audits')
      .select(
        `id, number, programme_id, area_id, standards, auditor_id, auditee,
         planned_date, conducted_date, status, created_at,
         audit_areas(name),
         audit_programmes(year),
         auditor:profiles!audits_auditor_id_fkey(full_name)`
      )
      .order('created_at', { ascending: false }),
    supabase.from('audit_findings').select('audit_id, status'),
    supabase
      .from('audit_areas')
      .select('id, name')
      .eq('active', true)
      .order('name'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
    supabase
      .from('form_templates')
      .select('id, name')
      .eq('kind', 'audit')
      .eq('active', true)
      .order('name'),
  ])

  // Findings counts per audit
  const findingsByAudit = new Map<string, { open: number; total: number }>()
  for (const f of findings ?? []) {
    const auditId = f.audit_id as string
    const entry = findingsByAudit.get(auditId) ?? { open: 0, total: 0 }
    entry.total++
    if (f.status === 'open') entry.open++
    findingsByAudit.set(auditId, entry)
  }

  const auditRows: AuditRow[] = (audits ?? []).map((a) => {
    const area = a.audit_areas as unknown as { name: string } | null
    const programme = a.audit_programmes as unknown as { year: string } | null
    const auditor = a.auditor as unknown as { full_name: string } | null
    const counts = findingsByAudit.get(a.id as string) ?? { open: 0, total: 0 }
    return {
      id: a.id as string,
      number: a.number as string,
      programme_id: a.programme_id as string,
      programme_year: programme?.year ?? '—',
      area_id: a.area_id as string,
      area_name: area?.name ?? '—',
      standards: (a.standards as AuditStandard[]) ?? [],
      auditor_name: auditor?.full_name ?? null,
      auditee: (a.auditee as string | null) ?? null,
      planned_date: (a.planned_date as string | null) ?? null,
      conducted_date: (a.conducted_date as string | null) ?? null,
      status: a.status as AuditStatus,
      open_findings: counts.open,
      total_findings: counts.total,
      overdue:
        a.status === 'planned' &&
        a.planned_date != null &&
        (a.planned_date as string) < today,
    }
  })

  const programmeRows: ProgrammeRow[] = (programmes ?? []).map((p) => ({
    id: p.id as string,
    year: p.year as string,
    title: p.title as string,
    status: p.status as AuditProgrammeStatus,
    notes: (p.notes as string | null) ?? null,
  }))

  const areaOptions: AreaOption[] = (areas ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  const templateOptions: TemplateOption[] = (templates ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Internal audit programme"
        description="Plan the audit year, conduct audits against ISO checklists, record findings and drive them to closure (ISO 9001/14001/45001 §9.2)."
      />
      <AuditsRegister
        audits={auditRows}
        programmes={programmeRows}
        areas={areaOptions}
        profiles={profileOptions}
        templates={templateOptions}
        role={profile.role}
      />
    </div>
  )
}
