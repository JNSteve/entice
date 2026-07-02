import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import {
  RisksClient,
  type RiskRow,
  type ProjectOption,
  type ProfileOption,
} from './risks-client'
import type { RiskRating } from '@/lib/risk'
import type { RiskKind, RiskSource, RiskDomain, RiskStatus } from '@/lib/zod'

export default async function WhsRisksPage() {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const [{ data: items }, { data: treatments }, { data: projects }, { data: profileRows }] =
    await Promise.all([
      supabase
        .from('risk_items')
        .select(
          `id, number, kind, title, source, iso_domain, category, project_id,
           likelihood, consequence, inherent_score, inherent_rating,
           residual_likelihood, residual_consequence, residual_score, residual_rating,
           review_date, status,
           projects(number, name),
           owner:profiles!risk_items_owner_id_fkey(full_name)`
        )
        .order('number'),
      supabase.from('risk_treatments').select('risk_item_id, status'),
      supabase
        .from('projects')
        .select('id, number, name')
        .eq('status', 'active')
        .order('number'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name'),
    ])

  const openByItem = new Map<string, number>()
  for (const t of treatments ?? []) {
    if (t.status !== 'open') continue
    const key = t.risk_item_id as string
    openByItem.set(key, (openByItem.get(key) ?? 0) + 1)
  }

  const rows: RiskRow[] = (items ?? []).map((r) => {
    const project = r.projects as unknown as {
      number: string
      name: string
    } | null
    const owner = r.owner as unknown as { full_name: string } | null
    return {
      id: r.id as string,
      number: r.number as string,
      kind: r.kind as RiskKind,
      title: r.title as string,
      source: r.source as RiskSource,
      iso_domain: r.iso_domain as RiskDomain,
      category: (r.category as string | null) ?? null,
      project_id: (r.project_id as string | null) ?? null,
      project_label: project ? `${project.number} — ${project.name}` : null,
      likelihood: Number(r.likelihood),
      consequence: Number(r.consequence),
      inherent_score: Number(r.inherent_score),
      inherent_rating: r.inherent_rating as RiskRating,
      residual_likelihood:
        r.residual_likelihood == null ? null : Number(r.residual_likelihood),
      residual_consequence:
        r.residual_consequence == null ? null : Number(r.residual_consequence),
      residual_score: r.residual_score == null ? null : Number(r.residual_score),
      residual_rating: (r.residual_rating as RiskRating | null) ?? null,
      owner_name: owner?.full_name ?? null,
      review_date: (r.review_date as string | null) ?? null,
      status: r.status as RiskStatus,
      open_treatment_count: openByItem.get(r.id as string) ?? 0,
    }
  })

  const projectOptions: ProjectOption[] = (projects ?? []).map((p) => ({
    id: p.id as string,
    number: p.number as string,
    name: p.name as string,
  }))

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Risk & opportunity register"
        description="Strategic and operational risks and opportunities across quality, environmental and OHS — rated on the fixed 5×5 matrix (ISO 9001/14001/45001 §6.1)."
      />
      <RisksClient
        items={rows}
        projects={projectOptions}
        profiles={profileOptions}
      />
    </div>
  )
}
