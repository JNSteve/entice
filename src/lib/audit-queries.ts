/**
 * Shared audit log query helpers.
 *
 * These helpers are server-only (they use the server Supabase client) but the
 * returned data types are plain objects so they can be passed as props to
 * client components.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditRow {
  id: string
  at: string
  actor_id: string | null
  actor_name: string | null
  entity_type: string
  entity_id: string
  project_id: string | null
  action: string
  detail: Record<string, unknown>
}

// ─── Per-entity fetch ─────────────────────────────────────────────────────────

/**
 * Fetch audit log rows for a specific entity (e.g. entity_type='incidents',
 * entity_id=<uuid>). Ordered newest-first. Up to 200 rows.
 *
 * Pass the server Supabase client from `createClient()`.
 */
export async function fetchAuditFor(
  supabase: SupabaseClient,
  entityType: string,
  entityId: string
): Promise<AuditRow[]> {
  const { data } = await supabase
    .from('audit_log')
    .select('id, at, actor_id, actor_name, entity_type, entity_id, project_id, action, detail')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('at', { ascending: false })
    .limit(200)

  return (data ?? []).map((r) => ({
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
}
