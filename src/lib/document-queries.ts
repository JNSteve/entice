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
  const registers = await fetchAckRegisters(supabase, [documentId])
  return registers.get(documentId) ?? []
}

/**
 * Batched variant of fetchAckRegister: builds the acknowledgement register for
 * MANY issued documents with ONE active-staff query and ONE acknowledgements
 * query (`.in('document_id', …)`). Matching semantics are identical — acks
 * match by `document_id` alone. Every requested id is present in the result
 * (all-outstanding register when the document has no acks yet).
 */
export async function fetchAckRegisters(
  supabase: SupabaseClient,
  documentIds: string[]
): Promise<Map<string, AckRegisterRow[]>> {
  const registers = new Map<string, AckRegisterRow[]>()
  if (documentIds.length === 0) return registers

  const [{ data: staff }, { data: acks }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('active', true)
      .order('full_name'),
    supabase
      .from('document_acknowledgements')
      .select('document_id, user_id, acknowledged_at')
      .in('document_id', documentIds),
  ])

  // document_id → (user_id → acknowledged_at)
  const ackedByDoc = new Map<string, Map<string, string>>()
  for (const a of acks ?? []) {
    if (a.user_id === null) continue
    const docId = a.document_id as string
    let byUser = ackedByDoc.get(docId)
    if (!byUser) {
      byUser = new Map<string, string>()
      ackedByDoc.set(docId, byUser)
    }
    byUser.set(a.user_id as string, a.acknowledged_at as string)
  }

  for (const docId of documentIds) {
    const ackedAtByUser = ackedByDoc.get(docId)
    registers.set(
      docId,
      (staff ?? []).map((p) => ({
        user_id: p.id as string,
        name: p.full_name as string,
        role: p.role as AckRegisterRow['role'],
        acknowledged_at: ackedAtByUser?.get(p.id as string) ?? null,
      }))
    )
  }
  return registers
}
