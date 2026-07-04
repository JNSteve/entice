'use server'

import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { clientLinkCreateSchema } from '@/lib/zod'

/**
 * Staff-side management of client portal links (client_links table), cloned
 * from the share_links pattern (src/lib/share-links.ts). The public
 * consumption side lives in /portal/[token] via anon security-definer RPCs.
 * Admin/office only — supervisors are read-only office-side.
 */

export type CreateClientLinkResult =
  | { id: string; token: string; url: string; error?: never }
  | { error: string }

/** Origin must be a plain http(s) origin — anything odd falls back to env. */
function safeOrigin(origin: string | null): string {
  const fallback = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  if (!origin) return fallback
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return fallback
    return url.origin
  } catch {
    return fallback
  }
}

/**
 * Issues a portal link for a client organisation. Returns the full public
 * URL for copy/email. The token is the credential — treat the URL like a
 * password for that client's compliance data.
 */
export async function createClientLink(data: unknown): Promise<CreateClientLinkResult> {
  const profile = await requireRole('admin', 'office')

  const parsed = clientLinkCreateSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const token = crypto.randomBytes(24).toString('base64url')
  const expiresAt = parsed.data.expiresDays
    ? new Date(Date.now() + parsed.data.expiresDays * 86_400_000).toISOString()
    : null

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('client_links')
    .insert({
      client_id: parsed.data.client_id,
      token,
      label: parsed.data.label,
      expires_at: expiresAt,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Could not create link' }

  revalidatePath(`/clients/${parsed.data.client_id}`)
  return {
    id: row.id as string,
    token,
    url: `${safeOrigin(parsed.data.origin)}/portal/${token}`,
  }
}

/** Revokes a portal link — the portal treats it as dead immediately. */
export async function revokeClientLink(
  id: string,
  clientId: string
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('client_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('client_id', clientId)
  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return {}
}
