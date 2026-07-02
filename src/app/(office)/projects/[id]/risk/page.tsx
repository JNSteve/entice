import { notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  RisksClient,
  type RiskRow,
  type ProfileOption,
} from '@/app/(office)/whs/risks/risks-client'
import type { RiskRating } from '@/lib/risk'
import type { RiskKind, RiskSource, RiskDomain, RiskStatus } from '@/lib/zod'

export default async function ProjectRiskPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [{ data: project }, { data: items }, { data: profileRows }] =
    await Promise.all([
      supabase.from('projects').select('id, number, name').eq('id', id).single(),
      supabase
        .from('risk_items')
        .select(
          `id, number, kind, title, source, iso_domain, category, project_id,
           likelihood, consequence, inherent_score, inherent_rating,
           residual_likelihood, residual_consequence, residual_score, residual_rating,
           review_date, status,
           owner:profiles!risk_items_owner_id_fkey(full_name)`
        )
        .eq('project_id', id)
        .order('number'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name'),
    ])

  if (!project) notFound()

  // Open-treatment counts for this project's items only.
  const itemIds = (items ?? []).map((r) => r.id as string)
  const { data: treatments } = itemIds.length
    ? await supabase
        .from('risk_treatments')
        .select('risk_item_id, status')
        .in('risk_item_id', itemIds)
    : { data: [] as { risk_item_id: string; status: string }[] }

  const openByItem = new Map<string, number>()
  for (const t of treatments ?? []) {
    if (t.status !== 'open') continue
    const key = t.risk_item_id as string
    openByItem.set(key, (openByItem.get(key) ?? 0) + 1)
  }

  const projectLabel = `${project.number} — ${project.name}`

  const rows: RiskRow[] = (items ?? []).map((r) => {
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
      project_label: projectLabel,
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

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Project-scoped risks and opportunities (ISO 6.1). Company-wide items
          live in the{' '}
          <Link
            href="/whs/risks"
            className="underline underline-offset-2 hover:text-foreground"
          >
            central register
          </Link>
          .
        </p>
      </div>
      <RisksClient
        items={rows}
        projects={[]}
        profiles={profileOptions}
        lockedProject={{
          id: project.id as string,
          number: project.number as string,
          name: project.name as string,
        }}
      />
    </div>
  )
}
