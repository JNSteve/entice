import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  QualityView,
  type ItpInstanceRow,
  type ItpTemplateOption,
  type LotRow,
} from './quality-view'
import type { ItpItemStatus, LotStatus } from '@/lib/zod'

export default async function ProjectQualityPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: project },
    { data: templates },
    { data: instances },
    { data: instanceItems },
    { data: lots },
    { data: qualityHoldPoints },
  ] = await Promise.all([
    supabase.from('projects').select('id, number, name').eq('id', id).single(),
    supabase
      .from('itp_templates')
      .select('id, name, activity, discipline')
      .eq('active', true)
      .order('name'),
    supabase
      .from('itp_instances')
      .select('id, number, title, activity, status, adopted_at')
      .eq('project_id', id)
      .order('adopted_at', { ascending: false }),
    supabase
      .from('itp_instance_items')
      .select('id, instance_id, status, point_type, itp_instances!inner(project_id)')
      .eq('itp_instances.project_id', id),
    supabase
      .from('lots')
      .select('id, number, description, location, status, opened_on, itp_instance_id')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('hold_points')
      .select('id, lot_id, status')
      .eq('project_id', id)
      .eq('origin', 'quality'),
  ])

  if (!project) notFound()

  // Per-instance item tallies
  const itemTally = new Map<string, { total: number; passed: number; na: number; holds: number }>()
  for (const it of instanceItems ?? []) {
    const key = it.instance_id as string
    const t = itemTally.get(key) ?? { total: 0, passed: 0, na: 0, holds: 0 }
    t.total += 1
    if ((it.status as ItpItemStatus) === 'passed') t.passed += 1
    if ((it.status as ItpItemStatus) === 'na') t.na += 1
    if (it.point_type === 'hold') t.holds += 1
    itemTally.set(key, t)
  }

  // Per-lot open (unreleased) quality hold points
  const openHolds = new Map<string, number>()
  for (const hp of qualityHoldPoints ?? []) {
    if (hp.status === 'released' || !hp.lot_id) continue
    const key = hp.lot_id as string
    openHolds.set(key, (openHolds.get(key) ?? 0) + 1)
  }

  const instanceRows: ItpInstanceRow[] = (instances ?? []).map((i) => {
    const t = itemTally.get(i.id as string) ?? { total: 0, passed: 0, na: 0, holds: 0 }
    return {
      id: i.id as string,
      number: i.number as string,
      title: i.title as string,
      activity: i.activity as string,
      status: i.status as string,
      adopted_at: i.adopted_at as string,
      itemsTotal: t.total,
      itemsPassed: t.passed,
      itemsNa: t.na,
      holdItems: t.holds,
    }
  })

  const instanceNumber = new Map(instanceRows.map((i) => [i.id, i.number]))

  const lotRows: LotRow[] = (lots ?? []).map((l) => ({
    id: l.id as string,
    number: l.number as string,
    description: l.description as string,
    location: (l.location as string | null) ?? null,
    status: l.status as LotStatus,
    opened_on: l.opened_on as string,
    itpNumber: instanceNumber.get(l.itp_instance_id as string) ?? '—',
    openHoldPoints: openHolds.get(l.id as string) ?? 0,
  }))

  const templateOptions: ItpTemplateOption[] = (templates ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    activity: t.activity as string,
    discipline: (t.discipline as string | null) ?? null,
  }))

  return (
    <QualityView
      projectId={id}
      templates={templateOptions}
      instances={instanceRows}
      lots={lotRows}
      isAdmin={profile.role === 'admin'}
    />
  )
}
