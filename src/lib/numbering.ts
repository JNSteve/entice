import type { SupabaseClient } from '@supabase/supabase-js'
import { todayAU } from '@/lib/tz'

const PREFIX = { quote: 'Q', job: 'J', project: 'P', po: 'PO', invoice: 'INV', incident: 'INC', ncr: 'NCR', audit: 'AUD', competency: 'CMP', risk: 'RO', objective: 'OBJ', mgmt_review: 'MR', legal_obligation: 'LEG', access_review: 'ACR', waste_load: 'WL', itp: 'ITP', lot: 'LOT' } as const
export type SequenceKey = keyof typeof PREFIX

export async function nextNumber(supabase: SupabaseClient, key: SequenceKey): Promise<string> {
  const { data, error } = await supabase.rpc('next_number', { seq_key: key })
  if (error || typeof data !== 'number' || !Number.isFinite(data)) {
    throw new Error(`Failed to get next ${key} number: ${error?.message ?? 'no value returned'}`)
  }
  return `${PREFIX[key]}-${String(data).padStart(4, '0')}`
}

/** SMS-R-08 corrective action number: CAR-2026-11 (two digits, wider past 99). */
export function formatCarNumber(year: string, n: number): string {
  return `CAR-${year}-${String(n).padStart(2, '0')}`
}

/**
 * Next corrective action number. CARs run per Brisbane calendar year from the
 * `car:<year>` sequence (migration 0072); a new year's key starts at 01.
 */
export async function nextCarNumber(supabase: SupabaseClient, now: Date = new Date()): Promise<string> {
  const year = todayAU(now).slice(0, 4)
  const key = `car:${year}`
  const { data, error } = await supabase.rpc('next_number', { seq_key: key })
  if (error || typeof data !== 'number' || !Number.isFinite(data)) {
    throw new Error(`Failed to get next ${key} number: ${error?.message ?? 'no value returned'}`)
  }
  return formatCarNumber(year, data)
}
