import type { SupabaseClient } from '@supabase/supabase-js'

const PREFIX = { quote: 'Q', job: 'J', project: 'P', po: 'PO', invoice: 'INV' } as const
export type SequenceKey = keyof typeof PREFIX

export async function nextNumber(supabase: SupabaseClient, key: SequenceKey): Promise<string> {
  const { data, error } = await supabase.rpc('next_number', { seq_key: key })
  if (error || typeof data !== 'number' || !Number.isFinite(data)) {
    throw new Error(`Failed to get next ${key} number: ${error?.message ?? 'no value returned'}`)
  }
  return `${PREFIX[key]}-${String(data).padStart(4, '0')}`
}
