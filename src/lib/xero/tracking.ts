// src/lib/xero/tracking.ts
import { XeroApiError, type XeroApi } from './client'
import { loadMapping } from './mapping'
import type { TrackingRef } from './map'
import { logEvent, type Admin } from './register'
import type { XeroTrackingOption } from './types'

export type WorkRef = { kind: 'job' | 'project'; id: string; number: string }

/**
 * One tracking option per job/project number under the configured category
 * (spec §4 item 5). Returns null (and logs a warning) when no category is
 * configured or Xero refuses (e.g. the 100-option limit — VERIFY-3), so the
 * push continues without tracking.
 */
export async function ensureTrackingOption(
  admin: Admin,
  api: XeroApi,
  runId: string,
  work: WorkRef
): Promise<TrackingRef> {
  const mapping = await loadMapping(admin)
  if (!mapping.trackingCategoryId) return null
  const table = work.kind === 'job' ? 'jobs' : 'projects'

  const { data: row } = await admin.from(table).select('xero_tracking_option_id').eq('id', work.id).single()
  if (row?.xero_tracking_option_id) {
    return { categoryId: mapping.trackingCategoryId, optionId: row.xero_tracking_option_id as string }
  }

  // Reuse an option with the same name if the cache already knows it.
  const { data: cached } = await admin
    .from('xero_tracking_options')
    .select('id')
    .eq('category_id', mapping.trackingCategoryId)
    .eq('name', work.number)
    .maybeSingle()
  let optionId = cached?.id as string | undefined

  if (!optionId) {
    try {
      const res = await api.put<{ Options: XeroTrackingOption[] }>(
        `/TrackingCategories/${mapping.trackingCategoryId}/Options`,
        { Name: work.number }
      )
      optionId = res.Options[0].TrackingOptionID
      await admin.from('xero_tracking_options').upsert(
        { id: optionId, category_id: mapping.trackingCategoryId, name: work.number, status: 'ACTIVE', synced_at: new Date().toISOString() },
        { onConflict: 'id' }
      )
      await logEvent(admin, runId, {
        direction: 'push', entity: 'tracking', entityId: work.id, xeroId: optionId,
        action: 'created', detail: `Tracking option "${work.number}"`,
      })
    } catch (err) {
      const detail = err instanceof XeroApiError ? err.message : String(err)
      await logEvent(admin, runId, {
        direction: 'push', entity: 'tracking', entityId: work.id, action: 'warning',
        detail: `Could not create tracking option "${work.number}": ${detail}. Invoice pushed without tracking.`,
      })
      return null
    }
  }

  await admin.from(table).update({ xero_tracking_option_id: optionId }).eq('id', work.id)
  return { categoryId: mapping.trackingCategoryId, optionId }
}

/**
 * Archive options for jobs paid / projects closed more than 90 days ago
 * (spec §5.4 step 5). The only Xero mutation outside invoicing, and only on
 * options ECR created. Returns how many were archived.
 *
 * `jobs` and `projects` have no `updated_at` column (0001_schema.sql), so the
 * cutoff compares against `jobs.completed_at` (timestamptz) and
 * `projects.practical_completion_date` (date) instead.
 */
export async function archiveStaleTrackingOptions(admin: Admin, api: XeroApi, runId: string): Promise<number> {
  const mapping = await loadMapping(admin)
  if (!mapping.trackingCategoryId) return 0
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const [{ data: jobs }, { data: projects }] = await Promise.all([
    admin.from('jobs').select('id, number, xero_tracking_option_id')
      .eq('status', 'paid').not('xero_tracking_option_id', 'is', null).lt('completed_at', cutoff),
    admin.from('projects').select('id, number, xero_tracking_option_id')
      .eq('status', 'closed').not('xero_tracking_option_id', 'is', null).lt('practical_completion_date', cutoff.slice(0, 10)),
  ])

  const stale = [...(jobs ?? []), ...(projects ?? [])] as { id: string; number: string; xero_tracking_option_id: string }[]
  let archived = 0
  for (const w of stale) {
    const { data: opt } = await admin.from('xero_tracking_options').select('status').eq('id', w.xero_tracking_option_id).maybeSingle()
    if (opt?.status === 'ARCHIVED') continue
    try {
      await api.post(`/TrackingCategories/${mapping.trackingCategoryId}/Options/${w.xero_tracking_option_id}`, { Status: 'ARCHIVED' })
      await admin.from('xero_tracking_options').update({ status: 'ARCHIVED' }).eq('id', w.xero_tracking_option_id)
      await logEvent(admin, runId, { direction: 'push', entity: 'tracking', entityId: w.id, xeroId: w.xero_tracking_option_id, action: 'archived', detail: w.number })
      archived++
    } catch (err) {
      await logEvent(admin, runId, { direction: 'push', entity: 'tracking', entityId: w.id, action: 'warning', detail: `Archive failed: ${err instanceof Error ? err.message : String(err)}` })
    }
  }
  return archived
}
