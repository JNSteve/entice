// CP3 notifications — the event-driven senders (fired via next/server
// `after()` so they NEVER block or fail the action that triggered them) and
// the daily digest engine consumed by /api/cron/notify.
//
// Recipient rules (documented decisions):
//   * Office alerts go to the company email (settings.email). When it is not
//     set, the attempt is logged as 'skipped' — visible in Settings → Email.
//   * Client emails go to the client's PRIMARY contact: the first contact
//     (ordered by name, matching the office contacts table) with an email
//     address. No contact email → logged skip, never an error.
//   * Portal links in client emails use the request's own link when it is
//     still live, else the newest live link; no live link → no button.
//   * notifications_enabled (per client link) gates ONLY the daily client
//     compliance digest. Transactional updates (request status, message
//     replies) always go out — they answer something the client did.
//
// Every send lands in email_log via src/lib/email.ts (sent|failed|skipped).

import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { createPublicClient } from '@/lib/supabase/public'
import {
  alreadySentToday,
  renderEmail,
  sendEmail,
  type SendEmailResult,
} from '@/lib/email'
import {
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
  type RequestStatus,
  type RequestUrgency,
} from '@/lib/portal-interactions'
import {
  isClientLinkActive,
  PROPERTY_COMPLIANCE_KIND_LABELS,
  type PropertyComplianceKind,
} from '@/lib/portal'
import { fmtDate } from '@/lib/format'
import { dateAU, todayAU } from '@/lib/tz'

/** Public origin for portal/office links in emails; null → buttons omitted. */
function appBaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!url) return null
  return url.replace(/\/$/, '')
}

/** Truncated single-block preview of a free-text body for email quotes. */
function preview(body: string, max = 400): string {
  const trimmed = body.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed
}

type ContactRow = { name: string; email: string | null }

/** First contact (by name) with an email — the "primary" contact. */
export function primaryContactEmail(contacts: ContactRow[]): string | null {
  const withEmail = [...contacts]
    .sort((a, b) => a.name.localeCompare(b.name))
    .find((c) => c.email && c.email.trim() !== '')
  return withEmail?.email?.trim() ?? null
}

type LinkRow = {
  id: string
  token: string
  revoked_at: string | null
  expires_at: string | null
  notifications_enabled?: boolean
}

/** The live link to deep-link a client email to (prefer `preferredId`). */
export function pickLiveLink(
  links: LinkRow[],
  preferredId?: string | null
): LinkRow | null {
  const live = links.filter((l) => isClientLinkActive(l))
  if (live.length === 0) return null
  return live.find((l) => l.id === preferredId) ?? live[0]
}

// ─── Event-driven: portal → office ───────────────────────────────────────────

type PortalBrandingLite = {
  client_name: string
  company_name: string
  company_email: string | null
}

/**
 * Office alert: a client posted a message through the portal. Runs in the
 * ANONYMOUS portal action context — reads go through token-validated RPCs.
 */
export async function notifyOfficeNewMessage(input: {
  token: string
  siteId: string
  senderName: string
  body: string
}): Promise<void> {
  try {
    const supabase = createPublicClient()
    const [{ data: resolved }, { data: siteName }] = await Promise.all([
      supabase.rpc('portal_resolve_link', { p_token: input.token }),
      supabase.rpc('portal_site_name', { p_token: input.token, p_site: input.siteId }),
    ])
    const branding = (resolved ?? null) as PortalBrandingLite | null
    if (!branding) return

    const base = appBaseUrl()
    await sendEmail({
      to: branding.company_email,
      subject: `New portal message — ${branding.client_name}`,
      template: 'office_new_message',
      entityKind: 'portal_thread',
      entityId: input.siteId,
      html: renderEmail({
        companyName: branding.company_name,
        heading: 'New client message',
        intro: `${input.senderName} sent a message through the client portal.`,
        rows: [
          { label: 'Client', value: branding.client_name },
          { label: 'Property', value: (siteName as string | null) ?? '—' },
        ],
        quote: preview(input.body),
        cta: base ? { label: 'Open Entice', url: base } : null,
        footnote: 'Reply from the property page — the client is notified by email.',
      }),
    })
  } catch (err) {
    console.error('[notify] office new-message alert failed:', err)
  }
}

/**
 * Office alert: a client submitted a work request through the portal.
 * Anonymous portal action context.
 */
export async function notifyOfficeNewRequest(input: {
  token: string
  siteId: string
  requestId: string
  number: string
  title: string
  urgency: string
}): Promise<void> {
  try {
    const supabase = createPublicClient()
    const [{ data: resolved }, { data: siteName }] = await Promise.all([
      supabase.rpc('portal_resolve_link', { p_token: input.token }),
      supabase.rpc('portal_site_name', { p_token: input.token, p_site: input.siteId }),
    ])
    const branding = (resolved ?? null) as PortalBrandingLite | null
    if (!branding) return

    const base = appBaseUrl()
    await sendEmail({
      to: branding.company_email,
      subject: `${input.number} — new work request from ${branding.client_name}`,
      template: 'office_new_request',
      entityKind: 'portal_request',
      entityId: input.requestId,
      html: renderEmail({
        companyName: branding.company_name,
        heading: 'New work request',
        rows: [
          { label: 'Request', value: `${input.number} — ${input.title}` },
          { label: 'Client', value: branding.client_name },
          { label: 'Property', value: (siteName as string | null) ?? '—' },
          {
            label: 'Urgency',
            value:
              REQUEST_URGENCY_LABELS[input.urgency as RequestUrgency] ??
              input.urgency,
          },
        ],
        cta: base ? { label: 'Open the requests register', url: `${base}/clients/requests` } : null,
      }),
    })
  } catch (err) {
    console.error('[notify] office new-request alert failed:', err)
  }
}

// ─── Event-driven: office → client ───────────────────────────────────────────

/**
 * Client update: a work request changed status (reviewed/quoted/scheduled/
 * completed/declined, incl. convert-to-quote). Runs in the OFFICE action
 * context (authenticated admin/office session).
 */
export async function notifyClientRequestStatus(input: {
  requestId: string
  status: string
}): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: request } = await supabase
      .from('portal_requests')
      .select('id, number, title, client_id, site_id, client_link_id')
      .eq('id', input.requestId)
      .single()
    if (!request) return

    const [{ data: site }, { data: contacts }, { data: links }, { data: settings }] =
      await Promise.all([
        supabase.from('sites').select('name').eq('id', request.site_id).single(),
        supabase
          .from('contacts')
          .select('name, email')
          .eq('client_id', request.client_id)
          .order('name'),
        supabase
          .from('client_links')
          .select('id, token, revoked_at, expires_at')
          .eq('client_id', request.client_id)
          .order('created_at', { ascending: false }),
        supabase.from('settings').select('company_name').eq('id', 1).single(),
      ])

    const statusLabel =
      REQUEST_STATUS_LABELS[input.status as RequestStatus] ?? input.status
    const link = pickLiveLink((links ?? []) as LinkRow[], request.client_link_id)
    const base = appBaseUrl()
    const portalUrl =
      base && link
        ? `${base}/portal/${link.token}/sites/${request.site_id}?tab=requests`
        : null

    await sendEmail({
      to: primaryContactEmail((contacts ?? []) as ContactRow[]),
      subject: `${request.number} update — ${statusLabel}`,
      template: 'client_request_status',
      entityKind: 'portal_request',
      entityId: request.id,
      html: renderEmail({
        companyName: settings?.company_name ?? 'Entice',
        heading: `Your request is now ${statusLabel.toLowerCase()}`,
        intro: `An update on the work request you raised with ${settings?.company_name ?? 'us'}.`,
        rows: [
          { label: 'Request', value: `${request.number} — ${request.title}` },
          { label: 'Property', value: site?.name ?? '—' },
          { label: 'Status', value: statusLabel },
        ],
        cta: portalUrl ? { label: 'View in your portal', url: portalUrl } : null,
      }),
    })
  } catch (err) {
    console.error('[notify] client request-status email failed:', err)
  }
}

/**
 * Client update: the office replied on a property's message thread.
 * Office action context.
 */
export async function notifyClientMessageReply(input: {
  clientId: string
  siteId: string
  body: string
}): Promise<void> {
  try {
    const supabase = await createClient()
    const [
      { data: client },
      { data: site },
      { data: contacts },
      { data: links },
      { data: settings },
    ] = await Promise.all([
      supabase.from('clients').select('name').eq('id', input.clientId).single(),
      supabase.from('sites').select('name').eq('id', input.siteId).single(),
      supabase
        .from('contacts')
        .select('name, email')
        .eq('client_id', input.clientId)
        .order('name'),
      supabase
        .from('client_links')
        .select('id, token, revoked_at, expires_at')
        .eq('client_id', input.clientId)
        .order('created_at', { ascending: false }),
      supabase.from('settings').select('company_name').eq('id', 1).single(),
    ])
    if (!client) return

    const link = pickLiveLink((links ?? []) as LinkRow[])
    const base = appBaseUrl()
    const portalUrl =
      base && link
        ? `${base}/portal/${link.token}/sites/${input.siteId}?tab=messages`
        : null
    const companyName = settings?.company_name ?? 'Entice'

    await sendEmail({
      to: primaryContactEmail((contacts ?? []) as ContactRow[]),
      subject: `New message from ${companyName}${site?.name ? ` — ${site.name}` : ''}`,
      template: 'client_message_reply',
      entityKind: 'portal_thread',
      entityId: input.siteId,
      html: renderEmail({
        companyName,
        heading: `${companyName} replied`,
        intro: site?.name
          ? `There is a new message on ${site.name}.`
          : 'There is a new message on one of your properties.',
        quote: preview(input.body),
        cta: portalUrl ? { label: 'Read and reply in your portal', url: portalUrl } : null,
      }),
    })
  } catch (err) {
    console.error('[notify] client message-reply email failed:', err)
  }
}

// ─── Daily digests (cron) ────────────────────────────────────────────────────

type DigestItem = {
  siteName: string
  clientId: string
  title: string
  kind: string
  reviewDue: string
}

/** One human line per digest item: property — title (kind): overdue/due. */
export function digestLine(item: DigestItem, today: string): string {
  const kindLabel =
    PROPERTY_COMPLIANCE_KIND_LABELS[item.kind as PropertyComplianceKind] ??
    item.kind
  const due =
    item.reviewDue < today
      ? `overdue since ${fmtDate(item.reviewDue)}`
      : `due ${fmtDate(item.reviewDue)}`
  return `${item.siteName} — ${item.title} (${kindLabel}): ${due}`
}

export type DigestClientOutcome =
  | 'sent'
  | 'skipped'
  | 'failed'
  | 'already_sent'
  | 'notifications_off'
  | 'no_live_link'

export type DigestRunResult = {
  date: string
  clients: { client: string; items: number; outcome: DigestClientOutcome }[]
  office:
    | { outcome: 'sent' | 'skipped' | 'failed' | 'already_sent' | 'nothing_to_report' }
  errors: string[]
}

/** UTC instant of Brisbane midnight today — the dedup window start. */
function todayStartInstant(today: string): string {
  return new Date(`${today}T00:00:00+10:00`).toISOString()
}

async function digestDone(
  admin: SupabaseClient,
  template: string,
  entityKind: string,
  entityId: string | null,
  today: string
): Promise<boolean> {
  let query = admin
    .from('email_log')
    .select('created_at, status')
    .eq('template', template)
    .eq('entity_kind', entityKind)
    .gte('created_at', todayStartInstant(today))
  query = entityId ? query.eq('entity_id', entityId) : query.is('entity_id', null)
  const { data, error } = await query
  if (error) throw new Error(`email_log dedup query failed: ${error.message}`)
  return alreadySentToday((data ?? []) as { created_at: string; status: string }[], today)
}

/**
 * The daily notify run (6 am Brisbane via Vercel cron):
 *   1. Per client: compliance items due within 30 days or overdue across
 *      their properties → ONE digest email to the client's primary contact,
 *      gated by an active portal link with notifications_enabled.
 *   2. Office: a focused daily digest — portal-facing compliance counts,
 *      open work requests, unread client messages and expiring facility
 *      licences/permits — to the company email. Only sent when something
 *      needs attention.
 * Both are idempotent per Brisbane day via email_log (sent/skipped count as
 * done; failures retry on the next run). Requires the service-role client —
 * the cron has no user session.
 */
export async function runDailyDigests(admin: SupabaseClient): Promise<DigestRunResult> {
  const today = todayAU()
  const horizon = dateAU(30)
  const result: DigestRunResult = {
    date: today,
    clients: [],
    office: { outcome: 'nothing_to_report' },
    errors: [],
  }

  const [{ data: settings }, { data: dueItems }, { data: allLinks }] =
    await Promise.all([
      admin.from('settings').select('company_name, email').eq('id', 1).single(),
      admin
        .from('property_compliance_items')
        .select('title, kind, review_due, sites(id, name, client_id)')
        .eq('status', 'active')
        .not('review_due', 'is', null)
        .lte('review_due', horizon),
      admin
        .from('client_links')
        .select('id, client_id, token, revoked_at, expires_at, notifications_enabled')
        .order('created_at', { ascending: false }),
    ])
  const companyName = settings?.company_name ?? 'Entice'
  const base = appBaseUrl()

  // ── 1. Client digests ──────────────────────────────────────────────────────
  const itemsByClient = new Map<string, DigestItem[]>()
  for (const row of dueItems ?? []) {
    const site = row.sites as unknown as {
      id: string
      name: string
      client_id: string
    } | null
    if (!site) continue
    const item: DigestItem = {
      siteName: site.name,
      clientId: site.client_id,
      title: row.title as string,
      kind: row.kind as string,
      reviewDue: row.review_due as string,
    }
    const list = itemsByClient.get(site.client_id)
    if (list) list.push(item)
    else itemsByClient.set(site.client_id, [item])
  }

  const linksByClient = new Map<string, LinkRow[]>()
  for (const link of (allLinks ?? []) as (LinkRow & { client_id: string })[]) {
    const list = linksByClient.get(link.client_id)
    if (list) list.push(link)
    else linksByClient.set(link.client_id, [link])
  }

  const clientIds = [...itemsByClient.keys()]
  const [{ data: clients }, { data: contacts }] =
    clientIds.length > 0
      ? await Promise.all([
          admin.from('clients').select('id, name, archived').in('id', clientIds),
          admin
            .from('contacts')
            .select('client_id, name, email')
            .in('client_id', clientIds)
            .order('name'),
        ])
      : [{ data: [] }, { data: [] }]

  for (const [clientId, items] of itemsByClient) {
    const client = (clients ?? []).find((c) => c.id === clientId)
    if (!client || client.archived) continue
    const clientName = client.name as string

    try {
      const clientLinks = linksByClient.get(clientId) ?? []
      const liveLinks = clientLinks.filter((l) => isClientLinkActive(l))
      if (liveLinks.length === 0) {
        result.clients.push({ client: clientName, items: items.length, outcome: 'no_live_link' })
        continue
      }
      const enabledLink = liveLinks.find((l) => l.notifications_enabled !== false)
      if (!enabledLink) {
        result.clients.push({
          client: clientName,
          items: items.length,
          outcome: 'notifications_off',
        })
        continue
      }

      if (await digestDone(admin, 'client_compliance_digest', 'client', clientId, today)) {
        result.clients.push({ client: clientName, items: items.length, outcome: 'already_sent' })
        continue
      }

      const overdue = items.filter((i) => i.reviewDue < today).length
      const lines = [...items]
        .sort((a, b) => a.reviewDue.localeCompare(b.reviewDue))
        .map((i) => digestLine(i, today))
      const subjectBits = [
        overdue > 0 ? `${overdue} overdue` : null,
        items.length - overdue > 0 ? `${items.length - overdue} due soon` : null,
      ].filter(Boolean)

      const send: SendEmailResult = await sendEmail({
        to: primaryContactEmail(
          ((contacts ?? []) as (ContactRow & { client_id: string })[]).filter(
            (c) => c.client_id === clientId
          )
        ),
        subject: `Property compliance — ${subjectBits.join(', ')}`,
        template: 'client_compliance_digest',
        entityKind: 'client',
        entityId: clientId,
        html: renderEmail({
          companyName,
          heading: 'Property compliance needs attention',
          intro: `Across your properties, ${items.length} compliance ${items.length === 1 ? 'item' : 'items'} ${items.length === 1 ? 'is' : 'are'} due within 30 days or overdue.`,
          listItems: lines,
          cta: base
            ? { label: 'Open your portal', url: `${base}/portal/${enabledLink.token}` }
            : null,
          footnote:
            'You receive this daily summary while compliance reminders are enabled on your portal link — ask us to turn it off any time.',
        }),
      })
      result.clients.push({ client: clientName, items: items.length, outcome: send.status })
    } catch (err) {
      result.errors.push(
        `client ${clientName}: ${err instanceof Error ? err.message : String(err)}`
      )
      result.clients.push({ client: clientName, items: items.length, outcome: 'failed' })
    }
  }

  // ── 2. Office digest ───────────────────────────────────────────────────────
  try {
    const [
      { count: openRequests },
      { count: unreadMessages },
      { data: facilities },
      { data: permits },
    ] = await Promise.all([
      admin
        .from('portal_requests')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '(completed,declined)'),
      admin
        .from('portal_messages')
        .select('id', { count: 'exact', head: true })
        .eq('sender', 'client')
        .eq('read_by_office', false),
      admin
        .from('env_facilities')
        .select('name, licence_expiry')
        .eq('active', true)
        .not('licence_expiry', 'is', null)
        .lte('licence_expiry', horizon),
      admin
        .from('env_permits')
        .select('reference, expiry')
        .not('expiry', 'is', null)
        .lte('expiry', horizon),
    ])

    const dueCount = (dueItems ?? []).length
    const overdueCount = (dueItems ?? []).filter(
      (i) => (i.review_due as string) < today
    ).length
    const expiring = [
      ...(facilities ?? []).map(
        (f) => `Facility licence — ${f.name}: expires ${fmtDate(f.licence_expiry as string)}`
      ),
      ...(permits ?? []).map(
        (p) => `Permit ${p.reference}: expires ${fmtDate(p.expiry as string)}`
      ),
    ]

    const total =
      dueCount + (openRequests ?? 0) + (unreadMessages ?? 0) + expiring.length
    if (total === 0) {
      result.office = { outcome: 'nothing_to_report' }
    } else if (
      await digestDone(admin, 'office_daily_digest', 'office', null, today)
    ) {
      result.office = { outcome: 'already_sent' }
    } else {
      const lines = [
        dueCount > 0
          ? `Property compliance: ${dueCount} ${dueCount === 1 ? 'item' : 'items'} due within 30 days${overdueCount > 0 ? ` (${overdueCount} overdue)` : ''}`
          : null,
        (openRequests ?? 0) > 0
          ? `Work requests: ${openRequests} open`
          : null,
        (unreadMessages ?? 0) > 0
          ? `Portal messages: ${unreadMessages} unread`
          : null,
        ...expiring,
      ].filter((l): l is string => l !== null)

      const send = await sendEmail({
        to: settings?.email ?? null,
        subject: `Daily digest — ${lines.length} ${lines.length === 1 ? 'item needs' : 'items need'} attention`,
        template: 'office_daily_digest',
        entityKind: 'office',
        entityId: null,
        html: renderEmail({
          companyName,
          heading: 'Daily digest',
          intro: 'What needs attention across the client portal and registers today.',
          listItems: lines,
          cta: base ? { label: 'Open Entice', url: base } : null,
        }),
      })
      result.office = { outcome: send.status }
    }
  } catch (err) {
    result.errors.push(
      `office digest: ${err instanceof Error ? err.message : String(err)}`
    )
    result.office = { outcome: 'failed' }
  }

  return result
}
