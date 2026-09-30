import type { createClient } from '@/lib/supabase/server'
import {
  computePnl,
  type CostCategory,
  type CostSource,
  type PnlSummary,
} from '@/lib/pnl'

type Supabase = Awaited<ReturnType<typeof createClient>>

export interface PnlCostLine {
  id: string
  date: string
  description: string
  amount: number
  source: CostSource
  hours: number | null
  rate: number | null
  worker_id: string | null
  worker_name: string | null
  /** Staff name for worker_id, else the typed worker_name. */
  worker_label: string | null
  cost_code_id: string | null
  cost_code_label: string | null
  category: CostCategory | null
  rate_item_id: string | null
  qty: number | null
  unit_cost: number | null
}

export interface PnlWorkerOption {
  id: string
  full_name: string
  hourly_cost: number | null
}

export interface PnlCostCodeOption {
  id: string
  code: string
  name: string
}

export interface PnlAdjustment {
  id: string
  date: string
  description: string
  amount: number
}

export type PnlPrice =
  | {
      mode: 'job'
      basePrice: number | null
      hasQuote: boolean
      quoteNumber: string | null
      adjustments: PnlAdjustment[]
    }
  | { mode: 'project'; contractSum: number; approvedVariations: number }

export interface PnlData {
  summary: PnlSummary
  price: PnlPrice
  /** Settings GST rate (%) — for showing inc-GST equivalents only. */
  gstRate: number
  costLines: PnlCostLine[]
  workers: PnlWorkerOption[]
  costCodes: PnlCostCodeOption[]
}

const num = (v: unknown) => (v == null ? null : Number(v))

const PAGE = 1000

/**
 * PostgREST caps a response at 1000 rows — page until a short page so the
 * P&L totals never silently drop rows on long-running jobs.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

/** Everything the P&L panel needs for one job or project (admin/office only). */
export async function loadPnl(
  supabase: Supabase,
  parentType: 'job' | 'project',
  parentId: string
): Promise<PnlData | null> {
  const fk = parentType === 'job' ? 'job_id' : 'project_id'

  const [parentRes, priceRowsRes, costRows, timesheetRows, profilesRes, codesRes, settingsRes] =
    await Promise.all([
      parentType === 'job'
        ? supabase.from('jobs').select('id, quote_id, contract_price, quotes(number)').eq('id', parentId).maybeSingle()
        : supabase.from('projects').select('id, contract_sum').eq('id', parentId).maybeSingle(),
      parentType === 'job'
        ? supabase
            .from('job_price_adjustments')
            .select('id, date, description, amount')
            .eq('job_id', parentId)
            .order('date')
            .order('created_at')
        : supabase
            .from('variations')
            .select('id, sell_amount')
            .eq('project_id', parentId)
            .eq('status', 'approved'),
      fetchAll((from, to) =>
        supabase
          .from('costs')
          .select(
            'id, date, description, amount, source, hours, rate, worker_id, worker_name, cost_code_id, category, rate_item_id, qty, unit_cost, cost_codes(code, name, category)'
          )
          .eq('parent_type', parentType)
          .eq('parent_id', parentId)
          .order('date', { ascending: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to)
      ),
      fetchAll((from, to) =>
        supabase
          .from('timesheet_entries')
          .select('id, user_id, start_at, end_at, approved, cost_rate')
          .eq(fk, parentId)
          .order('id')
          .range(from, to)
      ),
      supabase.from('profiles').select('id, full_name, hourly_cost, active').order('full_name'),
      supabase.from('cost_codes').select('id, code, name, active').order('code'),
      supabase.from('settings').select('gst_rate').eq('id', 1).maybeSingle(),
    ])

  const parent = parentRes.data as
    | {
        id: string
        quote_id?: string | null
        contract_price?: unknown
        contract_sum?: unknown
        quotes?: { number: string } | null
      }
    | null
  if (!parent) return null

  const profiles = profilesRes.data ?? []
  const nameById = new Map(profiles.map((p) => [p.id as string, p.full_name as string]))

  const costLines: PnlCostLine[] = costRows.map((c) => {
    const code = c.cost_codes as unknown as { code: string; name: string } | null
    return {
      id: c.id,
      date: c.date,
      description: c.description,
      amount: Number(c.amount),
      source: c.source as CostSource,
      hours: num(c.hours),
      rate: num(c.rate),
      worker_id: c.worker_id,
      worker_name: c.worker_name,
      worker_label: c.worker_id ? nameById.get(c.worker_id) ?? 'Unknown' : c.worker_name,
      cost_code_id: c.cost_code_id,
      cost_code_label: code ? `${code.code} – ${code.name}` : null,
      category: (c.category as CostCategory | null) ?? null,
      rate_item_id: c.rate_item_id,
      qty: num(c.qty),
      unit_cost: num(c.unit_cost),
    }
  })

  let price: PnlPrice
  let basePrice: number | null
  let adjustments: number[]
  if (parentType === 'job') {
    const rows: PnlAdjustment[] = (priceRowsRes.data ?? []).map((a) => {
      const r = a as { id: string; date: string; description: string; amount: unknown }
      return { id: r.id, date: r.date, description: r.description, amount: Number(r.amount) }
    })
    basePrice = num(parent.contract_price)
    adjustments = rows.map((r) => r.amount)
    price = {
      mode: 'job',
      basePrice,
      hasQuote: Boolean(parent.quote_id),
      quoteNumber: parent.quotes?.number ?? null,
      adjustments: rows,
    }
  } else {
    const vos = (priceRowsRes.data ?? []).map((v) => Number((v as { sell_amount: unknown }).sell_amount))
    basePrice = Number(parent.contract_sum ?? 0)
    adjustments = vos
    price = {
      mode: 'project',
      contractSum: basePrice,
      approvedVariations: vos.reduce((s, v) => s + v, 0),
    }
  }

  const summary = computePnl({
    basePrice,
    adjustments,
    timesheets: timesheetRows.map((t) => ({
      userId: t.user_id,
      workerName: nameById.get(t.user_id) ?? 'Unknown',
      startAt: t.start_at,
      endAt: t.end_at,
      approved: t.approved,
      costRate: num(t.cost_rate),
    })),
    costs: costRows.map((c) => ({
      amount: Number(c.amount),
      source: c.source as CostSource,
      category:
        ((c.cost_codes as unknown as { category: CostCategory } | null)?.category ?? null),
      rowCategory: (c.category as CostCategory | null) ?? null,
    })),
  })

  const usedCodes = new Set(costRows.map((c) => c.cost_code_id).filter(Boolean))

  return {
    summary,
    price,
    gstRate: Number(settingsRes.data?.gst_rate ?? 10),
    costLines,
    workers: profiles
      .filter((p) => p.active)
      .map((p) => ({ id: p.id, full_name: p.full_name, hourly_cost: num(p.hourly_cost) })),
    costCodes: (codesRes.data ?? [])
      .filter((c) => c.active || usedCodes.has(c.id))
      .map((c) => ({ id: c.id, code: c.code, name: c.name })),
  }
}
