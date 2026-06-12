'use server'

import crypto from 'node:crypto'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

/**
 * Staff-side management of external share links (share_links table).
 * The public consumption side lives in /sign/[token] via anon RPCs.
 */

const createShareLinkSchema = z
  .object({
    kind: z.literal('signon'),
    swmsInstanceId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    formSubmissionId: z
      .uuid()
      .nullish()
      .transform((v) => v ?? null),
    label: z.string().trim().min(1, 'Label is required').max(200),
    expiresDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .nullish()
      .transform((v) => v ?? null),
    /** window.location.origin from the caller; env/localhost fallback. */
    origin: z
      .string()
      .nullish()
      .transform((v) => v ?? null),
  })
  .refine(
    (v) => Boolean(v.swmsInstanceId) !== Boolean(v.formSubmissionId),
    'Pick exactly one target — a SWMS instance or a form submission'
  )

export type CreateShareLinkResult =
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
 * Creates an external sign-on link for a SWMS instance or a form submission
 * (toolbox/induction). Returns the full public URL for copy/QR/mailto.
 */
export async function createShareLink(data: unknown): Promise<CreateShareLinkResult> {
  const profile = await requireRole('admin', 'office', 'supervisor')

  const parsed = createShareLinkSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }

  const token = crypto.randomBytes(24).toString('base64url')
  const expiresAt = parsed.data.expiresDays
    ? new Date(Date.now() + parsed.data.expiresDays * 86_400_000).toISOString()
    : null

  const supabase = await createClient()
  const { data: row, error } = await supabase
    .from('share_links')
    .insert({
      token,
      kind: parsed.data.kind,
      swms_instance_id: parsed.data.swmsInstanceId,
      form_submission_id: parsed.data.formSubmissionId,
      label: parsed.data.label,
      expires_at: expiresAt,
      created_by: profile.id,
    })
    .select('id')
    .single()
  if (error || !row) return { error: error?.message ?? 'Could not create link' }

  return {
    id: row.id as string,
    token,
    url: `${safeOrigin(parsed.data.origin)}/sign/${token}`,
  }
}

/** Deactivates a share link — the public page treats it as expired. */
export async function deactivateShareLink(id: string): Promise<{ error?: string }> {
  await requireRole('admin', 'office', 'supervisor')

  const supabase = await createClient()
  const { error } = await supabase
    .from('share_links')
    .update({ active: false })
    .eq('id', id)
  if (error) return { error: error.message }

  return {}
}
