'use server'

import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { AuditRow } from '@/lib/audit-queries'

const EXPORT_CAP = 5000

const SELECT =
  'id, at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail'

// Keep in sync with ENTITY_TYPE_LABELS in ./audit-table.tsx (a 'use client'
// module, so the map cannot be imported into this server action file).
const ENTITY_TYPES = new Set([
  'swms_instances',
  'swms_signatures',
  'hold_points',
  'form_templates',
  'form_submissions',
  'form_signons',
  'incidents',
  'corrective_actions',
  'subbie_swms',
  'share_links',
])

export interface AuditExportFilters {
  from: string
  to: string
  project_id: string
  entity_type: string
  actor: string
  action: string
}

/**
 * Fetches the CSV export dataset (up to EXPORT_CAP rows, newest first) for the
 * given filters. Called on demand from the export button so the register page
 * itself never loads the 5,000-row dataset.
 */
export async function fetchAuditExport(
  filters: AuditExportFilters
): Promise<{ error?: string; rows?: AuditRow[] }> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()

  // Same filter semantics as the register page (see ./page.tsx buildQuery).
  let q = supabase
    .from('audit_log')
    .select(SELECT)
    .gte('at', filters.from + 'T00:00:00')
    .lte('at', filters.to + 'T23:59:59')
  if (filters.project_id) q = q.eq('project_id', filters.project_id)
  if (filters.entity_type && ENTITY_TYPES.has(filters.entity_type)) {
    q = q.eq('entity_type', filters.entity_type)
  }
  if (filters.actor === '_external') {
    q = q.like('actor_name', 'External — %')
  } else if (filters.actor) {
    q = q.eq('actor_name', filters.actor)
  }
  if (filters.action === 'external') {
    q = q.like('action', 'external_%')
  } else if (
    filters.action &&
    ['insert', 'update', 'delete'].includes(filters.action)
  ) {
    q = q.eq('action', filters.action)
  }

  const { data, error } = await q
    .order('at', { ascending: false })
    .limit(EXPORT_CAP)

  if (error) return { error: error.message }

  const rows: AuditRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    at: r.at as string,
    actor_id: (r.actor_id as string | null) ?? null,
    actor_name: (r.actor_name as string | null) ?? null,
    entity_type: r.entity_type as string,
    entity_id: r.entity_id as string,
    project_id: (r.project_id as string | null) ?? null,
    action: r.action as string,
    detail: (r.detail ?? {}) as Record<string, unknown>,
  }))

  return { rows }
}
