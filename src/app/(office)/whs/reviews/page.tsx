import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/PageHeader'
import { todayAU } from '@/lib/tz'
import type { MgmtReviewStatus } from '@/lib/zod'
import {
  ReviewsClient,
  type ReviewRow,
  type ProfileOption,
} from './reviews-client'

export default async function WhsReviewsPage() {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  const [{ data: reviews }, { data: actions }, { data: profileRows }] =
    await Promise.all([
      supabase
        .from('management_reviews')
        .select(
          `id, number, review_date, period_covered, status, closed_at,
           chair:profiles!management_reviews_chaired_by_fkey(full_name)`
        )
        .order('review_date', { ascending: false })
        .order('number', { ascending: false }),
      supabase
        .from('management_review_actions')
        .select('review_id, status')
        .eq('status', 'open'),
      supabase
        .from('profiles')
        .select('id, full_name')
        .eq('active', true)
        .order('full_name'),
    ])

  const openActionsByReview = new Map<string, number>()
  for (const a of actions ?? []) {
    const key = a.review_id as string
    openActionsByReview.set(key, (openActionsByReview.get(key) ?? 0) + 1)
  }

  const rows: ReviewRow[] = (reviews ?? []).map((r) => {
    const chair = r.chair as unknown as { full_name: string } | null
    return {
      id: r.id as string,
      number: r.number as string,
      review_date: r.review_date as string,
      period_covered: (r.period_covered as string | null) ?? null,
      chair_name: chair?.full_name ?? null,
      status: r.status as MgmtReviewStatus,
      closed_at: (r.closed_at as string | null) ?? null,
      open_action_count: openActionsByReview.get(r.id as string) ?? 0,
    }
  })

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Management Reviews"
        description="Periodic top-management reviews of the integrated QHSE system — the mandated 9.3.2 inputs with live register snapshots, RAG-rated minutes and tracked output actions (ISO 9001/14001/45001 §9.3, per procedure INT-PRO-003)."
      />
      <ReviewsClient
        items={rows}
        profiles={profileOptions}
        canManage={profile.role === 'admin' || profile.role === 'office'}
        today={todayAU()}
      />
    </div>
  )
}
