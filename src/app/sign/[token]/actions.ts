'use server'

import { createPublicClient } from '@/lib/supabase/public'
import {
  MAX_SIGNATURE_CHARS,
  SIGNATURE_DATA_URL_PREFIX,
} from '@/lib/form-validate'

export interface SubmitSharedSignonInput {
  token: string
  name: string
  company: string
  signature: string
}

export type SubmitSharedSignonResult =
  | { signedAt: string; error?: never }
  | { error: string }

/**
 * Public (no-auth) external sign-on. All real validation and writes happen in
 * the security-definer submit_shared_signon RPC — the anon client can't touch
 * the tables directly. /sign is excluded from the auth proxy, so this Server
 * Function POST goes through without a session.
 */
export async function submitSharedSignon(
  input: SubmitSharedSignonInput
): Promise<SubmitSharedSignonResult> {
  const name = (input.name ?? '').trim()
  const company = (input.company ?? '').trim()
  const signature = input.signature ?? ''

  if (!name) return { error: 'Enter your name' }
  if (!company) return { error: 'Enter your company' }
  if (
    !signature.startsWith(SIGNATURE_DATA_URL_PREFIX) ||
    signature.length > MAX_SIGNATURE_CHARS
  ) {
    return { error: 'Signature is missing or too large — clear and sign again' }
  }

  const supabase = createPublicClient()
  const { error } = await supabase.rpc('submit_shared_signon', {
    p_token: input.token,
    p_name: name,
    p_company: company,
    p_signature_data: signature,
  })

  if (error) {
    const message = error.message.includes('invalid or expired link')
      ? 'This link has expired or been deactivated — ask the site supervisor for a new one.'
      : 'Could not record your sign-on — please try again.'
    return { error: message }
  }

  return { signedAt: new Date().toISOString() }
}
