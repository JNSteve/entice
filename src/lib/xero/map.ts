import { addDays, format, parseISO } from 'date-fns'
import { docTotals, round2 } from '@/lib/money'
import type {
  EcrClaimForPush,
  EcrInvoiceForPush,
  XeroContact,
  XeroInvoice,
  XeroInvoicePayload,
  XeroLineItem,
  XeroMapping,
} from './types'

/**
 * Pure ECR ↔ Xero mapping. No I/O. Everything here is unit-tested in
 * tests/xero-map.test.ts. Rules come from spec §5.2 / §5.3 / §7.
 */

// ─── Dates ───────────────────────────────────────────────────────────────────

const DOTNET_DATE = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/

/** Xero JSON dates arrive as "/Date(ms+0000)/", or ISO in *String fields. */
export function parseXeroInstant(v: string | undefined | null): string | null {
  if (!v) return null
  const m = DOTNET_DATE.exec(v)
  if (m) return new Date(Number(m[1])).toISOString()
  const d = new Date(v.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(v) ? v : `${v}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** Calendar date (YYYY-MM-DD) from any Xero date form. */
export function parseXeroDate(v: string | undefined | null): string | null {
  if (!v) return null
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(v)
  if (iso) return iso[1]
  const instant = parseXeroInstant(v)
  return instant ? instant.slice(0, 10) : null
}

/** Xero wants If-Modified-Since as UTC "yyyy-MM-ddTHH:mm:ss". */
export function ifModifiedSinceHeader(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19)
}

// ─── Contacts ────────────────────────────────────────────────────────────────

export function normaliseAbn(v: string | null | undefined): string | null {
  const digits = (v ?? '').replace(/\D/g, '')
  return digits.length === 11 ? digits : null
}

export type ClientForMatch = { id: string; name: string; abn: string | null }

/** ABN first, then exact case-insensitive name; ambiguous → null. */
export function matchContactToClient(
  contact: Pick<XeroContact, 'ContactID' | 'Name' | 'TaxNumber'>,
  clients: ClientForMatch[]
): string | null {
  const abn = normaliseAbn(contact.TaxNumber)
  if (abn) {
    const byAbn = clients.filter((c) => normaliseAbn(c.abn) === abn)
    if (byAbn.length === 1) return byAbn[0].id
    if (byAbn.length > 1) return null
  }
  const name = contact.Name.trim().toLowerCase()
  if (!name) return null
  const byName = clients.filter((c) => c.name.trim().toLowerCase() === name)
  return byName.length === 1 ? byName[0].id : null
}

// ─── Payloads ────────────────────────────────────────────────────────────────

const REFERENCE_MAX = 255
const NO_DESCRIPTION = '(no description)'

export type TrackingRef = { categoryId: string; optionId: string } | null

function trackingFor(tracking: TrackingRef) {
  return tracking
    ? [{ TrackingCategoryID: tracking.categoryId, TrackingOptionID: tracking.optionId }]
    : undefined
}

function dueDate(issue: string, explicit: string | null, terms: number): string {
  return explicit ?? format(addDays(parseISO(issue), terms), 'yyyy-MM-dd')
}

export function buildInvoicePayload(
  inv: EcrInvoiceForPush,
  mapping: XeroMapping,
  contactId: string,
  tracking: TrackingRef
): XeroInvoicePayload {
  const taxType = inv.gst_rate === 0 ? mapping.noGstTaxType : mapping.gstTaxType
  const reference = [inv.job_number, inv.job_title]
    .filter(Boolean)
    .join(' ')
    .slice(0, REFERENCE_MAX)
  const trackingList = trackingFor(tracking)

  const LineItems = inv.lines.map((l) => {
    const account =
      (l.kind && mapping.accountByKind[l.kind]) || mapping.defaultAccount || null
    if (!account) {
      throw new Error(
        'No Xero income account is mapped for this line — set a default income account in Settings → Xero.'
      )
    }
    return {
      Description: l.description.trim() || NO_DESCRIPTION,
      Quantity: l.qty,
      UnitAmount: l.unit_sell,
      AccountCode: account,
      TaxType: taxType,
      ...(trackingList ? { Tracking: trackingList } : {}),
    }
  })

  return {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    Date: inv.issue_date,
    DueDate: dueDate(inv.issue_date, inv.due_date, inv.payment_terms_days),
    InvoiceNumber: inv.number,
    Reference: reference,
    Status: 'AUTHORISED',
    LineAmountTypes: 'Exclusive',
    LineItems,
  }
}

export function claimInvoiceNumber(projectNumber: string, claimNumber: number): string {
  return `PC-${projectNumber}-${claimNumber}`
}

/** certified_amount is GST-inclusive in ECR (see markClaimPaid) → Inclusive line. */
export function buildClaimPayload(
  claim: EcrClaimForPush,
  mapping: XeroMapping,
  contactId: string,
  tracking: TrackingRef
): XeroInvoicePayload {
  if (!mapping.claimsAccount) {
    throw new Error('No Xero claims account is set — choose one in Settings → Xero.')
  }
  const trackingList = trackingFor(tracking)
  return {
    Type: 'ACCREC',
    Contact: { ContactID: contactId },
    Date: claim.reference_date,
    DueDate: dueDate(claim.reference_date, null, claim.payment_terms_days),
    InvoiceNumber: claimInvoiceNumber(claim.project_number, claim.claim_number),
    Reference: claim.project_number.slice(0, REFERENCE_MAX),
    Status: 'AUTHORISED',
    LineAmountTypes: 'Inclusive',
    LineItems: [
      {
        Description: `Progress claim PC-${claim.claim_number} — ${claim.project_number} ${claim.project_name}`,
        Quantity: 1,
        UnitAmount: claim.certified_amount,
        AccountCode: mapping.claimsAccount,
        TaxType: mapping.gstTaxType,
        ...(trackingList ? { Tracking: trackingList } : {}),
      },
    ],
  }
}

/**
 * Which same-numbered Xero invoice, if any, may be adopted by a push (spec
 * §5.2 step 4): only an ACCREC invoice for the SAME contact in AUTHORISED or
 * PAID. Voided/deleted ones are ignored. Anything else live with that number
 * (a supplier bill, another contact's invoice, a bookkeeper's DRAFT) is a
 * conflict — the push must fail rather than adopt or duplicate.
 */
export function pickAdoptableInvoice(
  candidates: XeroInvoice[],
  contactId: string
): { adopt: XeroInvoice | null; conflict: XeroInvoice | null } {
  const live = candidates.filter((i) => i.Status !== 'VOIDED' && i.Status !== 'DELETED')
  const adopt =
    live.find(
      (i) =>
        i.Type === 'ACCREC' &&
        (i.Status === 'AUTHORISED' || i.Status === 'PAID') &&
        i.Contact?.ContactID === contactId
    ) ?? null
  return { adopt, conflict: adopt ? null : (live[0] ?? null) }
}

// ─── Pull-side derivations ───────────────────────────────────────────────────

export type DerivedInvoiceStatus = { status: 'sent' | 'paid' | 'void'; paid_at: string | null }

/** Spec §7. */
export function deriveInvoiceStatusFromXero(
  x: Pick<XeroInvoice, 'Status' | 'AmountDue' | 'FullyPaidOnDate' | 'UpdatedDateUTC'>
): DerivedInvoiceStatus {
  if (x.Status === 'VOIDED' || x.Status === 'DELETED') return { status: 'void', paid_at: null }
  if (x.Status === 'PAID') {
    return {
      status: 'paid',
      paid_at: parseXeroInstant(x.FullyPaidOnDate) ?? parseXeroInstant(x.UpdatedDateUTC),
    }
  }
  if ((x.AmountDue ?? 1) <= 0) {
    return { status: 'paid', paid_at: parseXeroInstant(x.UpdatedDateUTC) }
  }
  return { status: 'sent', paid_at: null }
}

/** Per-line vs per-document GST rounding: tolerate 2 cents (spec §5.2 step 5). */
export function totalsDiffer(ecrTotal: number, xeroTotal: number | undefined): boolean {
  if (xeroTotal == null) return false
  return Math.abs(ecrTotal - xeroTotal) > 0.02
}

const WORK_NUMBER = /\b(RJ\d{5}|J-\d{4}|P-\d{4})\b/i

/** Job/project number inside a free-text Xero Reference, upper-cased. */
export function workNumberFromReference(ref: string | undefined | null): string | null {
  if (!ref) return null
  const m = WORK_NUMBER.exec(ref)
  return m ? m[1].toUpperCase() : null
}

export function xeroLinesToInvoiceLines(items: XeroLineItem[]) {
  return items.map((l, position) => ({
    description: l.Description?.trim() || NO_DESCRIPTION,
    qty: l.Quantity ?? 1,
    unit: 'ea',
    unit_sell: l.UnitAmount ?? 0,
    position,
  }))
}

export type MirrorLines = {
  lines: ReturnType<typeof xeroLinesToInvoiceLines>
  gst_rate: number
  /** false when sum(lines) × (1 + rate) is more than 2 cents off Xero's Total. */
  reconciles: boolean
}

/**
 * Mirror a Xero-raised invoice into ECR's ex-GST line model. ECR derives the
 * total as Σ(qty × unit_sell) × (1 + gst_rate/100), so Inclusive prices are
 * backed out and the rate comes from Xero's own SubTotal/TotalTax.
 */
export function mirrorLinesFromXero(
  x: Pick<XeroInvoice, 'LineItems' | 'LineAmountTypes' | 'SubTotal' | 'TotalTax' | 'Total'>
): MirrorLines {
  const subTotal = x.SubTotal ?? 0
  const totalTax = x.TotalTax ?? 0
  const rate =
    x.LineAmountTypes === 'NoTax' || subTotal <= 0 || totalTax <= 0
      ? 0
      : round2((totalTax / subTotal) * 100)
  const raw = xeroLinesToInvoiceLines(x.LineItems ?? [])
  const lines =
    x.LineAmountTypes === 'Inclusive' && rate > 0
      ? raw.map((l) => ({ ...l, unit_sell: round2(l.unit_sell / (1 + rate / 100)) }))
      : raw
  const { total } = docTotals(lines.map((l) => ({ qty: l.qty, unitSell: l.unit_sell })), rate)
  return { lines, gst_rate: rate, reconciles: !totalsDiffer(total, x.Total) }
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/** Xero's error bodies vary; pull the most specific human message we can. */
export function xeroErrorMessage(body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as {
      Elements?: { ValidationErrors?: { Message?: string }[] }[]
      Message?: string
      Detail?: string
      Title?: string
      error_description?: string
      error?: string
    }
    const validation = (Array.isArray(b.Elements) ? b.Elements : [])
      .flatMap((e) => (Array.isArray(e?.ValidationErrors) ? e.ValidationErrors : []))
      .map((v) => v?.Message)
      .filter(Boolean)
    if (validation.length > 0) return validation.join(' ')
    return b.Message ?? b.Detail ?? b.Title ?? b.error_description ?? b.error ?? 'Xero request failed'
  }
  return 'Xero request failed'
}
