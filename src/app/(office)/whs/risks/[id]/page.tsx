import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAuditFor } from '@/lib/audit-queries'
import type { AuditRow } from '@/lib/audit-queries'
import type { RiskRating } from '@/lib/risk'
import type { RiskKind, RiskSource, RiskDomain, RiskStatus } from '@/lib/zod'
import type { ProjectOption, ProfileOption } from '../risks-client'
import {
  RiskDetailClient,
  type RiskDetailData,
  type TreatmentRow,
} from './risk-detail'

export default async function RiskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: risk },
    { data: treatments },
    { data: projects },
    { data: profileRows },
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('risk_items')
      .select(
        `id, number, kind, title, context, source, iso_domain, category,
         project_id, existing_controls,
         likelihood, consequence, inherent_score, inherent_rating,
         residual_likelihood, residual_consequence, residual_score, residual_rating,
         owner_id, review_date, status, closed_at, created_at,
         projects(number, name),
         owner:profiles!risk_items_owner_id_fkey(full_name),
         creator:profiles!risk_items_created_by_fkey(full_name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('risk_treatments')
      .select(
        `id, risk_item_id, description, assigned_to, due_date, status, completed_at,
         profiles!risk_treatments_assigned_to_fkey(full_name)`
      )
      .eq('risk_item_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at'),
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
    fetchAuditFor(supabase, 'risk_items', id),
  ])

  if (!risk) notFound()

  const project = risk.projects as unknown as {
    number: string
    name: string
  } | null
  const owner = risk.owner as unknown as { full_name: string } | null
  const creator = risk.creator as unknown as { full_name: string } | null

  const riskData: RiskDetailData = {
    id: risk.id as string,
    number: risk.number as string,
    kind: risk.kind as RiskKind,
    title: risk.title as string,
    context: (risk.context as string | null) ?? null,
    source: risk.source as RiskSource,
    iso_domain: risk.iso_domain as RiskDomain,
    category: (risk.category as string | null) ?? null,
    project_id: (risk.project_id as string | null) ?? null,
    project_label: project ? `${project.number} — ${project.name}` : null,
    existing_controls: (risk.existing_controls as string | null) ?? null,
    likelihood: Number(risk.likelihood),
    consequence: Number(risk.consequence),
    inherent_score: Number(risk.inherent_score),
    inherent_rating: risk.inherent_rating as RiskRating,
    residual_likelihood:
      risk.residual_likelihood == null ? null : Number(risk.residual_likelihood),
    residual_consequence:
      risk.residual_consequence == null
        ? null
        : Number(risk.residual_consequence),
    residual_score:
      risk.residual_score == null ? null : Number(risk.residual_score),
    residual_rating: (risk.residual_rating as RiskRating | null) ?? null,
    owner_id: (risk.owner_id as string | null) ?? null,
    owner_name: owner?.full_name ?? null,
    review_date: (risk.review_date as string | null) ?? null,
    status: risk.status as RiskStatus,
    created_by_name: creator?.full_name ?? null,
    closed_at: (risk.closed_at as string | null) ?? null,
    created_at: risk.created_at as string,
  }

  const treatmentRows: TreatmentRow[] = (treatments ?? []).map((t) => {
    const assignee = t.profiles as unknown as { full_name: string } | null
    return {
      id: t.id as string,
      risk_item_id: t.risk_item_id as string,
      description: t.description as string,
      assigned_to: (t.assigned_to as string | null) ?? null,
      assigned_to_name: assignee?.full_name ?? null,
      due_date: (t.due_date as string | null) ?? null,
      status: t.status as string,
      completed_at: (t.completed_at as string | null) ?? null,
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
      <Link
        href="/whs/risks"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Risk & opportunity register
      </Link>
      <RiskDetailClient
        risk={riskData}
        treatments={treatmentRows}
        role={profile.role as 'admin' | 'office' | 'supervisor'}
        profileId={profile.id}
        projects={projectOptions}
        profiles={profileOptions}
        auditHistory={auditHistory as AuditRow[]}
      />
    </div>
  )
}
