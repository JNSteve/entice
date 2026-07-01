/**
 * Controlled document register query helpers (server-side only — they use the
 * server Supabase client). Returned shapes are plain objects safe to hand to
 * client components.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DocCategory, DocSystem, DocStatus } from '@/lib/zod'

// ─── Version ordinal ─────────────────────────────────────────────────────────

/**
 * The chain ordinal of a document = how many predecessors it has via the
 * supersedes chain, + 1. Original = 1, first revision = 2, … Used as the
 * integer "version" for acknowledgements so a new issued version resets the
 * acknowledgement register. Robust against cycles.
 */
export function versionOrdinal(
  id: string,
  supersedesById: Map<string, string | null>
): number {
  let n = 1
  let cur = supersedesById.get(id) ?? null
  const seen = new Set<string>([id])
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    n += 1
    cur = supersedesById.get(cur) ?? null
  }
  return n
}

// ─── Acknowledgement register ────────────────────────────────────────────────

export interface AckRegisterRow {
  user_id: string
  name: string
  role: 'admin' | 'office' | 'supervisor' | 'field'
  /** Acknowledged-at for the CURRENT version, or null = outstanding. */
  acknowledged_at: string | null
}

export interface DocumentDetail {
  id: string
  title: string
  category: DocCategory
  system: DocSystem
  doc_number: string | null
  version: string
  versionOrdinal: number
  status: DocStatus
  /** Acknowledgement register for an issued document's current version. */
  register: AckRegisterRow[]
  ackedCount: number
  registerTotal: number
}

/**
 * Builds the acknowledgement register for a single issued document: every
 * ACTIVE staff profile vs whether they have acknowledged THIS document row.
 *
 * Matching is by `document_id` alone. Each issued version is its own documents
 * row, so the row id is a stable key: deleting a superseded predecessor (which
 * shifts chain ordinals) never changes which acks match this row. The stored
 * `version` ordinal is informational only and is not used for matching.
 */
export async function fetchAckRegister(
  supabase: SupabaseClient,
  documentId: string
): Promise<AckRegisterRow[]> {
  const [{ data: staff }, { data: acks }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('active', true)
      .order('full_name'),
    supabase
      .from('document_acknowledgements')
      .select('user_id, acknowledged_at')
      .eq('document_id', documentId),
  ])

  const ackedAtByUser = new Map(
    (acks ?? [])
      .filter((a) => a.user_id !== null)
      .map((a) => [a.user_id as string, a.acknowledged_at as string])
  )

  return (staff ?? []).map((p) => ({
    user_id: p.id as string,
    name: p.full_name as string,
    role: p.role as AckRegisterRow['role'],
    acknowledged_at: ackedAtByUser.get(p.id as string) ?? null,
  }))
}
