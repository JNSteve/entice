'use server'

import crypto from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { clientLinkCreateSchema, clientLinkInviteSchema } from '@/lib/zod'
import { renderEmail, sendEmail } from '@/lib/email'
import { isClientLinkActive } from '@/lib/portal'

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

/**
 * Create-or-reuse the register-scope link for a site (the compliance-only
 * portal view a printed "asbestos register" QR poster points at). One live
 * register link per site; no expiry, no digest, no billing.
 */
export async function ensureRegisterLink(
  siteId: string
): Promise<{ token?: string; error?: string }> {
  const profile = await requireRole('admin', 'office')

  const supabase = await createClient()
  const { data: site } = await supabase
    .from('sites')
    .select('id, name, client_id')
    .eq('id', siteId)
    .single()
  if (!site) return { error: 'Site not found' }

  const { data: existing } = await supabase
    .from('client_links')
    .select('id, token, expires_at')
    .eq('site_id', siteId)
    .eq('scope', 'register')
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (existing && (!existing.expires_at || existing.expires_at > new Date().toISOString())) {
    return { token: existing.token as string }
  }

  const token = crypto.randomBytes(24).toString('base64url')
  const { error } = await supabase.from('client_links').insert({
    client_id: site.client_id,
    token,
    label: `Site register — ${site.name}`,
    scope: 'register',
    site_id: siteId,
    show_financials: false,
    notifications_enabled: false,
    created_by: profile.id,
  })
  if (error) return { error: error.message }

  revalidatePath(`/clients/${site.client_id}`)
  return { token }
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

/**
 * Billing tab gate (CP2b): when ON, this link's portal shows the property's
 * issued invoices and payment claims. Default OFF — money never leaks into
 * the portal unless office deliberately opens it per link.
 */
export async function setClientLinkFinancials(
  id: string,
  clientId: string,
  show: boolean
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('client_links')
    .update({ show_financials: show })
    .eq('id', id)
    .eq('client_id', clientId)
  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return {}
}

/**
 * Daily digest gate (CP3): while ON, this link entitles the client to the
 * daily compliance digest email (items due within 30 days / overdue across
 * their properties, 6 am Brisbane). Default ON; turning it off on every
 * active link suppresses the client's digest entirely. Transactional emails
 * (request updates, message replies) are not affected.
 */
export async function setClientLinkNotifications(
  id: string,
  clientId: string,
  enabled: boolean
): Promise<{ error?: string }> {
  await requireRole('admin', 'office')

  const supabase = await createClient()
  const { error } = await supabase
    .from('client_links')
    .update({ notifications_enabled: enabled })
    .eq('id', id)
    .eq('client_id', clientId)
  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return {}
}

/**
 * Emails a client contact their portal invite (branded, through the email
 * engine — logged as 'skipped' until RESEND_API_KEY/EMAIL_FROM exist).
 * The link must be live and both link and contact must belong to the client.
 */
export async function sendClientLinkInvite(
  data: unknown
): Promise<{ status: 'sent' | 'skipped' | 'failed'; to: string } | { error: string }> {
  await requireRole('admin', 'office')

  const parsed = clientLinkInviteSchema.safeParse(data)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid data' }
  }
  const { link_id, client_id, contact_id, note } = parsed.data

  const supabase = await createClient()
  const [{ data: link }, { data: contact }, { data: client }, { data: settings }] =
    await Promise.all([
      supabase
        .from('client_links')
        .select('id, token, client_id, revoked_at, expires_at, scope')
        .eq('id', link_id)
        .eq('client_id', client_id)
        .maybeSingle(),
      supabase
        .from('contacts')
        .select('id, name, email')
        .eq('id', contact_id)
        .eq('client_id', client_id)
        .maybeSingle(),
      supabase.from('clients').select('name').eq('id', client_id).single(),
      supabase.from('settings').select('company_name').eq('id', 1).single(),
    ])

  if (!link || !isClientLinkActive(link)) return { error: 'That portal link is not active' }
  if (link.scope === 'register') {
    return { error: 'Register-scope links are for QR posters, not invites' }
  }
  if (!contact) return { error: 'Contact not found' }
  const to = contact.email?.trim()
  if (!to) return { error: `${contact.name} has no email address on record` }

  const company = settings?.company_name ?? 'Entice'
  const clientName = client?.name ?? 'your organisation'
  const url = `${safeOrigin(parsed.data.origin ?? null)}/portal/${link.token}`

  const result = await sendEmail({
    to,
    subject: `Your ${company} client portal`,
    template: 'client_portal_invite',
    entityKind: 'client_link',
    entityId: link.id as string,
    html: renderEmail({
      companyName: company,
      heading: `Your ${company} client portal`,
      intro: `${company} has set up a secure online portal for ${clientName}. Use it to review and sign quotes, follow works in progress, view photos and close-out reports, and request new work.`,
      quote: note?.trim() || null,
      cta: { label: 'Open your portal', url },
      footnote: 'Keep this link private — anyone with it can view your portal.',
    }),
  })

  revalidatePath(`/clients/${client_id}`)
  return { status: result.status, to }
}
