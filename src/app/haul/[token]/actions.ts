'use server'

import { z } from 'zod'
import { createPublicClient } from '@/lib/supabase/public'
import { VEHICLE_TYPES } from '@/lib/waste/qld-codes'

/**
 * Public (no-auth) transporter submission — Part 2 of the waste transport
 * certificate. The token IS the credential: waste_link_submit_transporter is a
 * security-definer RPC granted to anon which re-validates the token, refuses a
 * second submission and refuses once the load is lodged. /haul is excluded
 * from the auth proxy so this Server Function POST goes through without a
 * session.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v && v.trim() !== '' ? v.trim() : null))

const submitTransporterSchema = z
  .object({
    token: z.string().min(1),
    submittedBy: z.string().trim().min(1, 'Enter your name').max(100),
    collectionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the collection date'),
    vehicle1Plate: z
      .string()
      .trim()
      .min(1, 'Enter the vehicle 1 number plate')
      .max(7, 'A number plate is at most 7 characters'),
    vehicle1Type: z.enum(VEHICLE_TYPES),
    // [VERIFY V-5] The specification marks Vehicle 2 null-not-allowed, but a
    // rigid tipper with no trailer has no second vehicle.
    vehicle2Plate: optional(7),
    vehicle2Type: z
      .enum(VEHICLE_TYPES)
      .nullish()
      .transform((v) => v ?? null),
    discrepancy: optional(225),
    /**
     * Details the driver corrected about their own company. Recorded against
     * the movement and flagged for office review — never written back over the
     * vendor record, which sits behind a statutory record.
     */
    declaredVariance: z
      .record(z.string(), z.string())
      .nullish()
      .transform((v) => (v && Object.keys(v).length > 0 ? v : null)),
  })
  .refine((d) => !d.vehicle2Plate || d.vehicle2Type !== null, {
    message: 'Pick whether vehicle 2 is a vehicle or a trailer',
    path: ['vehicle2Type'],
  })

export type SubmitTransporterResult =
  | { ok: true; loadSeq: number; error?: never }
  | { error: string }

export async function submitTransporterPart(
  input: unknown
): Promise<SubmitTransporterResult> {
  const parsed = submitTransporterSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const d = parsed.data

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('waste_link_submit_transporter', {
    p_token: d.token,
    p_submitted_by: d.submittedBy,
    p_collection_date: d.collectionDate,
    p_vehicle1_plate: d.vehicle1Plate,
    p_vehicle1_type: d.vehicle1Type,
    p_vehicle2_plate: d.vehicle2Plate,
    p_vehicle2_type: d.vehicle2Type,
    p_discrepancy: d.discrepancy,
    p_declared_variance: d.declaredVariance,
  })

  if (error) return { error: 'Could not record the transport details — please try again.' }

  const payload = (data ?? null) as { ok?: boolean; load_seq?: number; error?: string } | null
  if (!payload?.ok) {
    return { error: payload?.error ?? 'Could not record the transport details.' }
  }
  return { ok: true, loadSeq: payload.load_seq ?? 0 }
}
