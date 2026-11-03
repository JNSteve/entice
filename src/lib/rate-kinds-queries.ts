import type { createClient } from '@/lib/supabase/server'
import { BUILTIN_RATE_KINDS, sortRateKinds, type RateKindRow } from './rate-kinds'

type Supabase = Awaited<ReturnType<typeof createClient>>

/**
 * The rate-category catalog in display order. Falls back to the built-ins
 * when the table cannot be read (not yet migrated), so every kind picker
 * keeps working between a deploy and the owner applying the migration.
 */
export async function loadRateKinds(supabase: Supabase): Promise<RateKindRow[]> {
  const { data, error } = await supabase.from('rate_kinds').select('key, label, builtin')
  if (error || !data || data.length === 0) return [...BUILTIN_RATE_KINDS]
  return sortRateKinds(
    data.map((r) => ({ key: String(r.key), label: String(r.label), builtin: Boolean(r.builtin) }))
  )
}
