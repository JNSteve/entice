import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeftIcon } from 'lucide-react'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchAuditFor } from '@/lib/audit-queries'
import type { AuditRow } from '@/lib/audit-queries'
import { todayAU } from '@/lib/tz'
import { MGMT_REVIEW_INPUT_KEYS, type MgmtReviewInputKey } from '@/lib/mgmt-review'
import type { InputSnapshot } from '@/lib/mgmt-review-data'
import type { MgmtReviewStatus, RagStatus } from '@/lib/zod'
import type { ProfileOption } from '../reviews-client'
import {
  ReviewDetailClient,
  type ReviewDetailData,
  type InputRow,
  type AttendeeRow,
  type ActionRow,
} from './review-detail'

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const { id } = await params
  const supabase = await createClient()

  const [
    { data: review },
    { data: inputs },
    { data: attendees },
    { data: actions },
    { data: profileRows },
    auditHistory,
  ] = await Promise.all([
    supabase
      .from('management_reviews')
      .select(
        `id, number, review_date, period_covered, status, general_minutes,
         chaired_by, closed_at, created_at,
         chair:profiles!management_reviews_chaired_by_fkey(full_name),
         creator:profiles!management_reviews_created_by_fkey(full_name)`
      )
      .eq('id', id)
      .single(),
    supabase
      .from('management_review_inputs')
      .select(
        `id, input_key, rag, minute, data, reviewed, reviewed_at,
         reviewer:profiles!management_review_inputs_reviewed_by_fkey(full_name)`
      )
      .eq('review_id', id),
    supabase
      .from('management_review_attendees')
      .select(
        `id, profile_id, name, role_title,
         profiles!management_review_attendees_profile_id_fkey(full_name)`
      )
      .eq('review_id', id)
      .order('created_at'),
    supabase
      .from('management_review_actions')
      .select(
        `id, description, assigned_to, due_date, status, completed_at,
         profiles!management_review_actions_assigned_to_fkey(full_name)`
      )
      .eq('review_id', id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('active', true)
      .order('full_name'),
    fetchAuditFor(supabase, 'management_reviews', id),
  ])

  if (!review) notFound()

  const chair = review.chair as unknown as { full_name: string } | null
  const creator = review.creator as unknown as { full_name: string } | null

  const data: ReviewDetailData = {
    id: review.id as string,
    number: review.number as string,
    review_date: review.review_date as string,
    period_covered: (review.period_covered as string | null) ?? null,
    status: review.status as MgmtReviewStatus,
    general_minutes: (review.general_minutes as string | null) ?? null,
    chaired_by: (review.chaired_by as string | null) ?? null,
    chair_name: chair?.full_name ?? null,
    created_by_name: creator?.full_name ?? null,
    closed_at: (review.closed_at as string | null) ?? null,
    created_at: review.created_at as string,
  }

  // Present the inputs in the controlled-list order, not row order.
  const inputByKey = new Map(
    (inputs ?? []).map((i) => [i.input_key as MgmtReviewInputKey, i])
  )
  const inputRows: InputRow[] = MGMT_REVIEW_INPUT_KEYS.flatMap((key) => {
    const i = inputByKey.get(key)
    if (!i) return []
    const reviewer = i.reviewer as unknown as { full_name: string } | null
    return [
      {
        id: i.id as string,
        input_key: key,
        rag: (i.rag as RagStatus | null) ?? null,
        minute: (i.minute as string | null) ?? null,
        data: (i.data as InputSnapshot | null) ?? null,
        reviewed: Boolean(i.reviewed),
        reviewed_by_name: reviewer?.full_name ?? null,
        reviewed_at: (i.reviewed_at as string | null) ?? null,
      },
    ]
  })

  const attendeeRows: AttendeeRow[] = (attendees ?? []).map((a) => {
    const p = a.profiles as unknown as { full_name: string } | null
    return {
      id: a.id as string,
      profile_id: (a.profile_id as string | null) ?? null,
      name: p?.full_name ?? (a.name as string | null) ?? '—',
      role_title: (a.role_title as string | null) ?? null,
      external: a.profile_id == null,
    }
  })

  const actionRows: ActionRow[] = (actions ?? []).map((a) => {
    const assignee = a.profiles as unknown as { full_name: string } | null
    return {
      id: a.id as string,
      description: a.description as string,
      assigned_to: (a.assigned_to as string | null) ?? null,
      assigned_to_name: assignee?.full_name ?? null,
      due_date: (a.due_date as string | null) ?? null,
      status: a.status as 'open' | 'done',
      completed_at: (a.completed_at as string | null) ?? null,
    }
  })

  const profileOptions: ProfileOption[] = (profileRows ?? []).map((p) => ({
    id: p.id as string,
    full_name: p.full_name as string,
  }))

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/whs/reviews"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Management Reviews
      </Link>
      <ReviewDetailClient
        review={data}
        inputs={inputRows}
        attendees={attendeeRows}
        actions={actionRows}
        role={profile.role as 'admin' | 'office' | 'supervisor'}
        profiles={profileOptions}
        auditHistory={auditHistory as AuditRow[]}
        today={todayAU()}
      />
    </div>
  )
}
