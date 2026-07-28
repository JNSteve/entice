'use server'

import { z } from 'zod'
import { createPublicClient } from '@/lib/supabase/public'
import {
  BUDF_UNITS,
  PHYSICAL_NATURES,
  isValidDisposalCode,
  isValidWasteCode,
} from '@/lib/waste/qld-codes'

/**
 * Public (no-auth) receiver submission — Part 3 of the waste transport
 * certificate. The token IS the credential: waste_link_submit_receiver is a
 * security-definer RPC granted to anon which re-validates the token, refuses a
 * second submission and refuses once the load is lodged. /receive is excluded
 * from the auth proxy so this Server Function POST goes through without a
 * session.
 */

const submitReceiverSchema = z.object({
  token: z.string().min(1),
  submittedBy: z.string().trim().min(1, 'Enter your name').max(100),
  receivedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the date the waste was received'),
  disposalCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidDisposalCode, 'Pick a disposal or treatment code'),
  physicalNature: z.enum(PHYSICAL_NATURES),
  wasteCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidWasteCode, 'Pick the waste code'),
  amount: z.coerce
    .number()
    .nonnegative('Amount cannot be negative')
    .max(99_999_999, 'Amount is too large'),
  unit: z.enum(BUDF_UNITS),
  discrepancy: z
    .string()
    .trim()
    .max(225)
    .nullish()
    .transform((v) => (v && v.trim() !== '' ? v.trim() : null)),
})

export type SubmitReceiverResult =
  | { ok: true; loadSeq: number; error?: never }
  | { error: string }

export async function submitReceiverPart(
  input: unknown
): Promise<SubmitReceiverResult> {
  const parsed = submitReceiverSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const d = parsed.data

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('waste_link_submit_receiver', {
    p_token: d.token,
    p_submitted_by: d.submittedBy,
    p_received_date: d.receivedDate,
    p_disposal_code: d.disposalCode,
    p_physical_nature: d.physicalNature,
    p_waste_code: d.wasteCode,
    p_amount: d.amount,
    p_unit: d.unit,
    p_discrepancy: d.discrepancy,
  })

  if (error) return { error: 'Could not record the receipt — please try again.' }

  const payload = (data ?? null) as { ok?: boolean; load_seq?: number; error?: string } | null
  if (!payload?.ok) {
    return { error: payload?.error ?? 'Could not record the receipt.' }
  }
  return { ok: true, loadSeq: payload.load_seq ?? 0 }
}
