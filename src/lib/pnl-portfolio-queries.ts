import type { createClient } from '@/lib/supabase/server'
import type { CostSource } from '@/lib/pnl'
import { fetchAll } from '@/lib/pnl-queries'
import {
  buildPortfolioRows,
  jobStage,
  parentKey,
  projectStage,
  type PortfolioParent,
  type PortfolioRow,
} from '@/lib/pnl-portfolio'
import { todayAU } from '@/lib/tz'

type Supabase = Awaited<ReturnType<typeof createClient>>

const JOB_STATUSES = ['scheduled', 'in_progress', 'completed', 'invoiced', 'paid']
const PROJECT_STATUSES = ['active', 'practical_completion', 'defects_liability', 'closed']

const num = (v: unknown) => (v == null ? null : Number(v))

/**
 * P&L for every live and closed-out job/project in a handful of paged bulk
 * queries — same maths as the job page (computePnl). Admin/office only.
 */
export async function loadPortfolioPnl(
  supabase: Supabase
): Promise<{ rows: PortfolioRow[]; today: string }> {
  const [jobs, projects, adjustments, variations, costs, timesheets] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from('jobs')
        .select('id, number, title, status, archived, completed_at, contract_price')
        .in('status', JOB_STATUSES)
        .order('id')
        .range(from, to)
    ),
    fetchAll((from, to) =>
      supabase
        .from('projects')
        .select('id, number, name, status, archived, practical_completion_date, contract_sum')
        .in('status', PROJECT_STATUSES)
        .order('id')
        .range(from, to)
    ),
    fetchAll((from, to) =>
      supabase.from('job_price_adjustments').select('id, job_id, amount').order('id').range(from, to)
    ),
    fetchAll((from, to) =>
      supabase
        .from('variations')
        .select('id, project_id, sell_amount')
        .eq('status', 'approved')
        .order('id')
        .range(from, to)
    ),
    fetchAll((from, to) =>
      supabase.from('costs').select('id, parent_type, parent_id, amount, source').order('id').range(from, to)
    ),
    fetchAll((from, to) =>
      supabase
        .from('timesheet_entries')
        .select('id, job_id, project_id, user_id, start_at, end_at, approved, cost_rate')
        .order('id')
        .range(from, to)
    ),
  ])

  const adjByJob = new Map<string, number[]>()
  for (const a of adjustments) {
    const list = adjByJob.get(a.job_id) ?? []
    list.push(Number(a.amount))
    adjByJob.set(a.job_id, list)
  }
  const voByProject = new Map<string, number[]>()
  for (const v of variations) {
    const list = voByProject.get(v.project_id) ?? []
    list.push(Number(v.sell_amount))
    voByProject.set(v.project_id, list)
  }

  const parents: PortfolioParent[] = []
  for (const j of jobs) {
    const stage = jobStage(j.status)
    // Live work excludes archived; finished work counts even once archived.
    if (!stage || (stage === 'live' && j.archived)) continue
    parents.push({
      kind: 'job',
      id: j.id,
      number: j.number,
      title: j.title,
      status: j.status,
      stage,
      closedOn: stage === 'closed' && j.completed_at ? todayAU(new Date(j.completed_at)) : null,
      basePrice: num(j.contract_price),
      adjustments: adjByJob.get(j.id) ?? [],
    })
  }
  for (const p of projects) {
    const stage = projectStage(p.status)
    if (!stage || (stage === 'live' && p.archived)) continue
    parents.push({
      kind: 'project',
      id: p.id,
      number: p.number,
      title: p.name,
      status: p.status,
      stage,
      closedOn: stage === 'closed' ? p.practical_completion_date : null,
      basePrice: Number(p.contract_sum ?? 0),
      adjustments: voByProject.get(p.id) ?? [],
    })
  }

  const rows = buildPortfolioRows(
    parents,
    timesheets
      .filter((t) => t.job_id || t.project_id)
      .map((t) => ({
        parentKey: t.job_id ? parentKey('job', t.job_id) : parentKey('project', t.project_id!),
        userId: t.user_id,
        workerName: '',
        startAt: t.start_at,
        endAt: t.end_at,
        approved: t.approved,
        costRate: num(t.cost_rate),
      })),
    costs.map((c) => ({
      parentKey: parentKey(c.parent_type as 'job' | 'project', c.parent_id),
      amount: Number(c.amount),
      source: c.source as CostSource,
      category: null,
    }))
  )

  return { rows, today: todayAU() }
}
