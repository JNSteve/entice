// CP3 email engine — a thin send wrapper around the Resend REST API (plain
// fetch, no SDK) plus the branded HTML template and the digest-idempotency
// rule. SERVER ONLY for sending; the render/dedup helpers are pure and
// unit-tested (tests/email.test.ts).
//
// Degradation contract (same shape as the backup route): when RESEND_API_KEY
// or EMAIL_FROM is missing the wrapper does NOT throw and does NOT send — it
// records the attempt in email_log with status 'skipped'. The moment the
// owner adds both env vars, the exact same call paths go live. sendEmail
// NEVER throws: notification paths are fire-and-forget (`after()`) and must
// never break the action that triggered them.
//
// Every attempt (sent | failed | skipped) lands in email_log via the
// log_email() SECURITY DEFINER fn (0033) — the one write path that works from
// all three calling contexts: anonymous portal actions, office server
// actions and the CRON route.

import { createPublicClient } from '@/lib/supabase/public'
import { todayAU } from '@/lib/tz'

// ─── Template keys ───────────────────────────────────────────────────────────

export const EMAIL_TEMPLATES = [
  'office_new_message',
  'office_new_request',
  'client_request_status',
  'client_message_reply',
  'client_compliance_digest',
  'office_daily_digest',
  'test',
] as const

export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number]

export const EMAIL_TEMPLATE_LABELS: Record<EmailTemplate, string> = {
  office_new_message: 'Office alert — new client message',
  office_new_request: 'Office alert — new work request',
  client_request_status: 'Client — request status update',
  client_message_reply: 'Client — office replied',
  client_compliance_digest: 'Client — compliance digest',
  office_daily_digest: 'Office — daily digest',
  test: 'Test email',
}

// ─── Configuration state ─────────────────────────────────────────────────────

export type EmailConfig = {
  apiKey: string | null
  from: string | null
  /** true only when BOTH the API key and the from address are present. */
  configured: boolean
}

export function emailConfig(): EmailConfig {
  const apiKey = process.env.RESEND_API_KEY?.trim() || null
  const from = process.env.EMAIL_FROM?.trim() || null
  return { apiKey, from, configured: Boolean(apiKey && from) }
}

// ─── Branded HTML template (pure) ────────────────────────────────────────────

/** Minimal HTML entity escaping for text interpolated into the template. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export type EmailContent = {
  /** Company name for the header band and footer line. */
  companyName: string
  /** Headline inside the body, e.g. "New work request". */
  heading: string
  /** Optional lead paragraph under the heading. */
  intro?: string | null
  /** Label/value detail rows (request number, property, status, …). */
  rows?: { label: string; value: string }[]
  /** Bullet list (digest line items). */
  listItems?: string[]
  /** Optional quoted block (message body preview). */
  quote?: string | null
  /** Optional call-to-action button. */
  cta?: { label: string; url: string } | null
  /** Optional muted note above the footer. */
  footnote?: string | null
}

const NAVY = '#1e3a5f'

/**
 * Branded, minimal, table-free HTML email matching the portal design
 * language: navy header band, clean body, muted footer
 * "{company} — sent via the client portal". Inline styles only (email
 * clients ignore stylesheets); every interpolated string is escaped.
 */
export function renderEmail(content: EmailContent): string {
  const rows = (content.rows ?? [])
    .map(
      (r) =>
        `<tr>` +
        `<td style="padding:4px 12px 4px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(r.label)}</td>` +
        `<td style="padding:4px 0;color:#1c2434;font-size:13px;">${escapeHtml(r.value)}</td>` +
        `</tr>`
    )
    .join('')

  const list = (content.listItems ?? [])
    .map(
      (item) =>
        `<li style="margin:0 0 6px;color:#1c2434;font-size:13px;line-height:1.5;">${escapeHtml(item)}</li>`
    )
    .join('')

  return [
    `<div style="margin:0;padding:24px 12px;background-color:#f1f5f9;font-family:Helvetica,Arial,sans-serif;">`,
    `<div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0;">`,
    // Navy header band
    `<div style="background-color:${NAVY};padding:18px 24px;">`,
    `<span style="color:#ffffff;font-size:16px;font-weight:bold;letter-spacing:0.3px;">${escapeHtml(content.companyName)}</span>`,
    `</div>`,
    // Body
    `<div style="padding:24px;">`,
    `<h1 style="margin:0 0 12px;font-size:18px;color:#1c2434;">${escapeHtml(content.heading)}</h1>`,
    content.intro
      ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#3e4a5e;">${escapeHtml(content.intro)}</p>`
      : '',
    rows ? `<table style="border-collapse:collapse;margin:0 0 16px;">${rows}</table>` : '',
    content.quote
      ? `<div style="margin:0 0 16px;padding:12px 16px;background-color:#f7f9fc;border-left:3px solid ${NAVY};border-radius:0 8px 8px 0;color:#3e4a5e;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(content.quote)}</div>`
      : '',
    list ? `<ul style="margin:0 0 16px;padding-left:20px;">${list}</ul>` : '',
    content.cta
      ? `<a href="${escapeHtml(content.cta.url)}" style="display:inline-block;margin:4px 0 8px;padding:11px 20px;background-color:${NAVY};color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;border-radius:10px;">${escapeHtml(content.cta.label)}</a>`
      : '',
    content.footnote
      ? `<p style="margin:16px 0 0;font-size:12px;color:#8b97a8;">${escapeHtml(content.footnote)}</p>`
      : '',
    `</div>`,
    // Footer
    `<div style="padding:14px 24px;border-top:1px solid #eef1f6;">`,
    `<p style="margin:0;font-size:12px;color:#8b97a8;">${escapeHtml(content.companyName)} — sent via the client portal</p>`,
    `</div>`,
    `</div>`,
    `</div>`,
  ].join('')
}

// ─── Digest idempotency (pure) ───────────────────────────────────────────────

/**
 * True when one of the prior email_log rows for this template+entity was
 * created on the SAME Brisbane calendar day — the daily digest must not go
 * out twice. A 'skipped' attempt counts as done (once the owner adds the API
 * key mid-day, that day's digest is not re-sent; failures do NOT count, so a
 * transient provider outage retries on the next run).
 */
export function alreadySentToday(
  priorRows: { created_at: string; status: string }[],
  today: string = todayAU()
): boolean {
  return priorRows.some(
    (r) =>
      (r.status === 'sent' || r.status === 'skipped') &&
      todayAU(new Date(r.created_at)) === today
  )
}

// ─── Send wrapper ────────────────────────────────────────────────────────────

export type SendEmailInput = {
  /** Recipient; null/empty is logged as skipped ("no recipient"). */
  to: string | null | undefined
  subject: string
  html: string
  template: EmailTemplate
  /** Related entity for the log ('portal_request', 'client', …). */
  entityKind?: string | null
  entityId?: string | null
}

export type SendEmailResult = {
  status: 'sent' | 'failed' | 'skipped'
  providerId?: string
  error?: string
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const SEND_TIMEOUT_MS = 15_000

/** Write the attempt to email_log via the definer fn; never throws. */
async function logAttempt(
  input: SendEmailInput,
  result: SendEmailResult
): Promise<void> {
  try {
    const supabase = createPublicClient()
    await supabase.rpc('log_email', {
      p_to: input.to ?? null,
      p_subject: input.subject,
      p_template: input.template,
      p_status: result.status,
      p_entity_kind: input.entityKind ?? null,
      p_entity_id: input.entityId ?? null,
      p_provider_id: result.providerId ?? null,
      p_error: result.error ?? null,
    })
  } catch (err) {
    console.error('[email] failed to write email_log:', err)
  }
}

/**
 * Sends one email through the Resend REST API and records the attempt.
 * NEVER throws — callers fire-and-forget from `after()` callbacks and cron
 * loops. With no RESEND_API_KEY/EMAIL_FROM configured the attempt is logged
 * as 'skipped' and nothing leaves the server.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  let result: SendEmailResult

  const to = input.to?.trim() || null
  const { apiKey, from, configured } = emailConfig()

  if (!to) {
    result = { status: 'skipped', error: 'No recipient email on record' }
  } else if (!configured || !apiKey || !from) {
    result = {
      status: 'skipped',
      error:
        'Email sending not configured — add RESEND_API_KEY and EMAIL_FROM to the environment',
    }
  } else {
    try {
      const response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [to],
          subject: input.subject,
          html: input.html,
        }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      })
      if (response.ok) {
        const body = (await response.json().catch(() => null)) as {
          id?: string
        } | null
        result = { status: 'sent', providerId: body?.id }
      } else {
        const text = await response.text().catch(() => '')
        result = {
          status: 'failed',
          error: `Resend ${response.status}: ${text.slice(0, 500)}`,
        }
      }
    } catch (err) {
      result = {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  await logAttempt(input, result)
  return result
}
