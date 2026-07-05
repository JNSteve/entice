'use server'

import { headers } from 'next/headers'
import { createPublicClient } from '@/lib/supabase/public'
import {
  MAX_SIGNATURE_CHARS,
  SIGNATURE_DATA_URL_PREFIX,
} from '@/lib/form-validate'
import {
  MAX_REQUEST_PHOTOS,
  REQUEST_URGENCIES,
  type RequestUrgency,
} from '@/lib/portal-interactions'

/**
 * Public (no-auth) portal interactions. All real validation, entitlement
 * checks and rate limits live in the SECURITY DEFINER RPCs
 * (0029_portal_interactions.sql) — the anon client cannot touch the tables.
 * /portal is excluded from the auth proxy, so these Server Function POSTs go
 * through without a session; the token IS the credential and every RPC
 * returns null for dead tokens.
 */

type PortalActionResult = { ok: true; number?: string } | { error: string }

const DEAD_LINK_MESSAGE =
  'This portal link is no longer active — contact your account manager for a new one.'
const GENERIC_FAILURE = 'Something went wrong — please try again.'

function mapRpcResult(
  data: unknown,
  rateLimitMessage: string
): PortalActionResult {
  const result = (data ?? null) as { ok?: boolean; number?: string; error?: string } | null
  if (!result) return { error: DEAD_LINK_MESSAGE }
  if (result.ok) return { ok: true, number: result.number }
  if (result.error === 'rate_limited') return { error: rateLimitMessage }
  if (result.error === 'not_acceptable') {
    return {
      error:
        'This item can no longer be signed — it may have already been decided. Refresh the page to see its current state.',
    }
  }
  return { error: GENERIC_FAILURE }
}

// ─── Correspondence ──────────────────────────────────────────────────────────

export async function postPortalMessage(input: {
  token: string
  siteId: string
  name: string
  body: string
}): Promise<PortalActionResult> {
  const name = (input.name ?? '').trim()
  const body = (input.body ?? '').trim()
  if (!name) return { error: 'Enter your name' }
  if (!body) return { error: 'Enter a message' }
  if (body.length > 2000) return { error: 'Messages are limited to 2000 characters' }

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('portal_post_message', {
    p_token: input.token,
    p_site: input.siteId,
    p_name: name,
    p_body: body,
  })
  if (error) return { error: GENERIC_FAILURE }
  return mapRpcResult(
    data,
    'You have sent a lot of messages in the last hour — please wait a little and try again.'
  )
}

// ─── Work requests ───────────────────────────────────────────────────────────

export async function submitPortalRequest(input: {
  token: string
  siteId: string
  title: string
  description: string
  urgency: string
  photoPaths: string[]
}): Promise<PortalActionResult> {
  const title = (input.title ?? '').trim()
  const description = (input.description ?? '').trim()
  if (!title) return { error: 'Enter a short title for the request' }
  if (title.length > 200) return { error: 'Keep the title under 200 characters' }
  if (!description) return { error: 'Describe the work you need' }
  if (description.length > 4000) {
    return { error: 'The description is limited to 4000 characters' }
  }
  if (!REQUEST_URGENCIES.includes(input.urgency as RequestUrgency)) {
    return { error: 'Pick an urgency' }
  }
  const photoPaths = (input.photoPaths ?? []).slice(0, MAX_REQUEST_PHOTOS)

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('portal_submit_request', {
    p_token: input.token,
    p_site: input.siteId,
    p_title: title,
    p_description: description,
    p_urgency: input.urgency,
    p_photo_paths: photoPaths,
  })
  if (error) return { error: GENERIC_FAILURE }
  return mapRpcResult(
    data,
    'You have reached the daily limit for new requests — please try again tomorrow or call us.'
  )
}

// ─── Approvals (sign on the glass) ───────────────────────────────────────────

async function requestIp(): Promise<string | null> {
  const h = await headers()
  const forwarded = h.get('x-forwarded-for')
  if (!forwarded) return null
  return forwarded.split(',')[0]?.trim() || null
}

export async function acceptPortalApproval(input: {
  token: string
  kind: 'quote' | 'variation'
  id: string
  signerName: string
  signature: string
}): Promise<PortalActionResult> {
  const signerName = (input.signerName ?? '').trim()
  const signature = input.signature ?? ''
  if (!signerName) return { error: 'Enter your full name' }
  if (
    !signature.startsWith(SIGNATURE_DATA_URL_PREFIX) ||
    signature.length > MAX_SIGNATURE_CHARS
  ) {
    return { error: 'Signature is missing or too large — clear and sign again' }
  }
  if (input.kind !== 'quote' && input.kind !== 'variation') {
    return { error: GENERIC_FAILURE }
  }

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('portal_accept', {
    p_token: input.token,
    p_kind: input.kind,
    p_id: input.id,
    p_signer_name: signerName,
    p_signature: signature,
    p_ip: await requestIp(),
  })
  if (error) return { error: GENERIC_FAILURE }
  return mapRpcResult(data, GENERIC_FAILURE)
}

export async function declinePortalApproval(input: {
  token: string
  kind: 'quote' | 'variation'
  id: string
  signerName: string
  reason: string
}): Promise<PortalActionResult> {
  const signerName = (input.signerName ?? '').trim()
  const reason = (input.reason ?? '').trim()
  if (!signerName) return { error: 'Enter your full name' }
  if (!reason) return { error: 'Let us know why you are declining' }
  if (reason.length > 1000) return { error: 'Keep the reason under 1000 characters' }
  if (input.kind !== 'quote' && input.kind !== 'variation') {
    return { error: GENERIC_FAILURE }
  }

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('portal_decline', {
    p_token: input.token,
    p_kind: input.kind,
    p_id: input.id,
    p_signer_name: signerName,
    p_reason: reason,
  })
  if (error) return { error: GENERIC_FAILURE }
  return mapRpcResult(data, GENERIC_FAILURE)
}
