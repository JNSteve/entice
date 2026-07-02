import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { refreshObjectiveKpis } from '@/lib/kpi-metrics'

export const runtime = 'nodejs'

/**
 * POST /api/kpi/refresh — recompute the auto-derived KPI values (ISO 9.1).
 *
 * Same engine as the "Refresh metrics" button. /api/* is excluded from the
 * auth proxy, so this route enforces auth itself: admin/office only (matches
 * the kpi_values RLS write policy — the engine runs under the caller's RLS).
 * A scheduled daily refresh (Vercel cron + CRON_SECRET hitting this route) is
 * a deliberate later ops task — see the roadmap's production-readiness phase.
 */
export async function POST() {
  const profile = await getProfile()
  if (!profile) return new Response('Unauthorized', { status: 401 })
  if (profile.role !== 'admin' && profile.role !== 'office') {
    return new Response('Forbidden', { status: 403 })
  }

  const supabase = await createClient()

  try {
    const result = await refreshObjectiveKpis(supabase)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refresh failed' },
      { status: 500 }
    )
  }
}
