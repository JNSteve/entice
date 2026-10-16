import { z } from 'zod'
import { format, isValid, parseISO } from 'date-fns'

// ─── SWMS title page ─────────────────────────────────────────────────────────
// Snapshot of client / job / site / contact taken at issue. Pre-filled from
// the portal, editable in the issue dialog, then frozen on the instance.

const text = z.string().default('')

export const swmsTitlePageSchema = z.object({
  client_name: text,
  principal_contractor: text,
  job_ref: text,
  site_address: text,
  work_dates: text,
  contact_name: text,
  contact_phone: text,
  contact_email: text,
})
export type SwmsTitlePage = z.infer<typeof swmsTitlePageSchema>

export const EMPTY_SWMS_TITLE_PAGE: SwmsTitlePage = swmsTitlePageSchema.parse({})

/** Field → label for the title page (render order matters). */
export const SWMS_TITLE_PAGE_LABELS: Record<keyof SwmsTitlePage, string> = {
  client_name: 'Client',
  principal_contractor: 'Principal contractor',
  job_ref: 'Job / project',
  site_address: 'Site address',
  work_dates: 'Work dates',
  contact_name: 'Client contact',
  contact_phone: 'Contact phone',
  contact_email: 'Contact email',
}

/** Stored jsonb → title page; null when absent, invalid or entirely blank. */
export function parseTitlePage(value: unknown): SwmsTitlePage | null {
  if (value == null) return null
  const parsed = swmsTitlePageSchema.safeParse(value)
  if (!parsed.success) return null
  return Object.values(parsed.data).some((v) => v.trim() !== '') ? parsed.data : null
}

// ─── Prefill ─────────────────────────────────────────────────────────────────

export type TitlePageContactOption = {
  id: string
  name: string
  role: string | null
  phone: string | null
  email: string | null
}

type SiteAddress = {
  address: string | null
  suburb: string | null
  state: string | null
  postcode: string | null
}

export type TitlePageSource = {
  /** "J-0042 — Asbestos removal" / "P-0003 — …". */
  parentRef: string
  client: { name: string; address: string | null } | null
  site: SiteAddress | null
  /** ISO dates (yyyy-mm-dd). */
  start: string | null
  end: string | null
  contacts: TitlePageContactOption[]
}

export type SwmsTitlePagePrefill = {
  values: SwmsTitlePage
  contacts: TitlePageContactOption[]
  /** Contact pre-picked in the dialog (only when the client has exactly one). */
  contactId: string | null
}

export const EMPTY_TITLE_PAGE_PREFILL: SwmsTitlePagePrefill = {
  values: EMPTY_SWMS_TITLE_PAGE,
  contacts: [],
  contactId: null,
}

export function formatSiteAddress(site: SiteAddress | null): string {
  if (!site) return ''
  const locality = [site.suburb, site.state, site.postcode]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(' ')
  return [site.address?.trim(), locality].filter(Boolean).join(', ')
}

function fmtDay(d: string | null): string {
  if (!d) return ''
  const date = parseISO(d)
  return isValid(date) ? format(date, 'd MMM yyyy') : ''
}

export function formatWorkDates(start: string | null, end: string | null): string {
  const s = fmtDay(start)
  const e = fmtDay(end)
  if (s && e) return s === e ? s : `${s} – ${e}`
  if (s) return `From ${s}`
  if (e) return `Until ${e}`
  return ''
}

/** Contact → the three contact fields. */
export function contactFields(
  c: TitlePageContactOption | null
): Pick<SwmsTitlePage, 'contact_name' | 'contact_phone' | 'contact_email'> {
  return {
    contact_name: c?.name ?? '',
    contact_phone: c?.phone ?? '',
    contact_email: c?.email ?? '',
  }
}

export function buildSwmsTitlePagePrefill(src: TitlePageSource): SwmsTitlePagePrefill {
  const clientName = src.client?.name ?? ''
  const picked = src.contacts.length === 1 ? src.contacts[0] : null
  return {
    values: {
      client_name: clientName,
      principal_contractor: clientName,
      job_ref: src.parentRef,
      site_address: formatSiteAddress(src.site) || (src.client?.address?.trim() ?? ''),
      work_dates: formatWorkDates(src.start, src.end),
      ...contactFields(picked),
    },
    contacts: src.contacts,
    contactId: picked?.id ?? null,
  }
}
