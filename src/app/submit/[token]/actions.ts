'use server'

import { z } from 'zod'
import { createPublicClient } from '@/lib/supabase/public'

const submitSubbieSwmsSchema = z.object({
  token: z.string().min(1),
  company: z.string().trim().min(1, 'Enter your company name').max(200),
  contact: z.string().trim().min(1, 'Enter a contact name').max(200),
  email: z.email('Enter a valid email address'),
  title: z.string().trim().min(1, 'Enter a title for the SWMS').max(300),
  /** Storage path of the already-uploaded PDF (anon upload, fixed prefix). */
  filePath: z
    .string()
    .regex(
      /^public-submissions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
      'Invalid file path'
    ),
})

export type SubmitSubbieSwmsResult = { ok: true; error?: never } | { error: string }

/**
 * Public (no-auth) subbie SWMS submission. The PDF is uploaded straight from
 * the browser with the anon client (storage policy only allows the
 * public-submissions/ prefix); this action then records the row via the
 * security-definer submit_subbie_swms RPC, which re-validates the token and
 * path. /submit is excluded from the auth proxy, so this Server Function
 * POST goes through without a session.
 */
export async function submitSubbieSwms(
  input: unknown
): Promise<SubmitSubbieSwmsResult> {
  const parsed = submitSubbieSwmsSchema.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const supabase = createPublicClient()
  const { error } = await supabase.rpc('submit_subbie_swms', {
    p_token: parsed.data.token,
    p_company: parsed.data.company,
    p_contact: parsed.data.contact,
    p_email: parsed.data.email,
    p_title: parsed.data.title,
    p_file_path: parsed.data.filePath,
  })

  if (error) {
    const message = error.message.includes('invalid or expired link')
      ? 'This link has expired or been deactivated — ask your contact for a new one.'
      : 'Could not record your submission — please try again.'
    return { error: message }
  }

  return { ok: true }
}
