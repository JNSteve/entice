import { renderToBuffer } from '@react-pdf/renderer'
import type { SupabaseClient } from '@supabase/supabase-js'
import { format, parseISO } from 'date-fns'
import type { SignoffSection, SignoffStatus } from '@/lib/signoffs'
import {
  DailySignoffPdf,
  type DailySignoffPdfLine,
  type DailySignoffPdfPhoto,
  type DailySignoffPdfResponse,
} from '@/pdf/DailySignoffPdf'
import { toDocCompany, type SettingsRow } from '@/pdf/build-quote-pdf'

// react-pdf's <Image> can only decode PNG/JPEG.
const PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png']
const MAX_PHOTOS = 12

type Named = { name: string } | null
type WorkRel = {
  number: string
  title?: string
  name?: string
  clients: Named
  sites: Named
} | null

/** "02/10/2026 16:42" in Brisbane time for an ISO instant. */
function fmtDateTimeAU(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Australia/Brisbane',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`
}

/** "02/10/2026" in Brisbane time for an ISO instant. */
function fmtDateAU(iso: string): string {
  return fmtDateTimeAU(iso).split(' ')[0]
}

/**
 * Shared daily sign-off PDF builder (office route with the authed client; a
 * portal proxy can pass a service-role client after its own entitlement
 * check). Quantities only — no money is loaded or rendered.
 */
export async function buildSignoffPdfResponse(
  supabase: SupabaseClient,
  id: string,
  opts: { watermark?: string | null } = {}
): Promise<Response> {
  const [{ data: signoff }, { data: lines }, { data: response }, { data: settings }] =
    await Promise.all([
      supabase
        .from('daily_signoffs')
        .select(
          'id, date, version, status, summary, photo_ids, released_at, jobs(number, title, clients(name), sites(name)), projects(number, name, clients(name), sites(name))'
        )
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('daily_signoff_lines')
        .select('id, sort, section, description, qty, unit, detail, scope_label')
        .eq('signoff_id', id)
        .order('sort')
        .order('id'),
      supabase
        .from('daily_signoff_responses')
        .select('signer_name, signature_data, disputes, ip, signed_at')
        .eq('signoff_id', id)
        .maybeSingle(),
      supabase
        .from('settings')
        .select('company_name, abn, address, phone, email, logo_path')
        .eq('id', 1)
        .single(),
    ])

  if (!signoff) return new Response('Not found', { status: 404 })

  const job = signoff.jobs as unknown as WorkRel
  const project = signoff.projects as unknown as WorkRel
  const work = job ?? project
  if (!work) return new Response('Not found', { status: 404 })

  const disputes = Array.isArray(response?.disputes)
    ? (response.disputes as { line_id: string; client_qty: number; reason: string }[])
    : []
  const disputeByLine = new Map(disputes.map((d) => [d.line_id, d]))

  const pdfLines: DailySignoffPdfLine[] = (lines ?? []).map((l) => {
    const d = disputeByLine.get(l.id as string)
    return {
      id: l.id as string,
      section: l.section as SignoffSection,
      description: l.description as string,
      qty: Number(l.qty),
      unit: (l.unit as string) ?? '',
      detail: (l.detail as string | null) ?? null,
      scope_label: (l.scope_label as string | null) ?? null,
      dispute: d ? { client_qty: Number(d.client_qty), reason: String(d.reason ?? '') } : null,
    }
  })

  // Photos: only the attachments chosen for the sheet, PNG/JPEG only, signed
  // for react-pdf to fetch at render time. Keep the sheet's photo order.
  const photoIds = ((signoff.photo_ids as string[] | null) ?? []).slice(0, MAX_PHOTOS)
  let photos: DailySignoffPdfPhoto[] = []
  if (photoIds.length > 0) {
    const { data: photoRows } = await supabase
      .from('attachments')
      .select('id, path, caption, content_type')
      .in('id', photoIds)
      .eq('kind', 'photo')
    const usable = (photoRows ?? []).filter((p) =>
      PHOTO_CONTENT_TYPES.includes(p.content_type as string)
    )
    const urlByPath = new Map<string, string>()
    if (usable.length > 0) {
      const { data: signed } = await supabase.storage
        .from('attachments')
        .createSignedUrls(usable.map((p) => p.path as string), 3600)
      for (const entry of signed ?? []) {
        if (entry.signedUrl && entry.path) urlByPath.set(entry.path, entry.signedUrl)
      }
    }
    const byId = new Map(usable.map((p) => [p.id as string, p]))
    photos = photoIds
      .map((pid) => byId.get(pid))
      .filter((p): p is NonNullable<typeof p> => !!p && urlByPath.has(p.path as string))
      .map((p) => ({
        url: urlByPath.get(p.path as string)!,
        caption: (p.caption as string | null) ?? null,
      }))
  }

  const pdfResponse: DailySignoffPdfResponse | null = response
    ? {
        signerName: response.signer_name as string,
        signedAt: fmtDateTimeAU(response.signed_at as string),
        signatureData: response.signature_data as string,
        ip: (response.ip as string | null) ?? null,
        disputeCount: disputes.length,
      }
    : null

  const date = signoff.date as string
  const workTitle = (job ? work.title : work.name) ?? ''

  const buffer = await renderToBuffer(
    <DailySignoffPdf
      sheet={{
        workNumber: work.number,
        workTitle,
        clientName: work.clients?.name ?? null,
        siteName: work.sites?.name ?? null,
        day: format(parseISO(date), 'EEEE dd/MM/yyyy'),
        version: Number(signoff.version),
        status: signoff.status as SignoffStatus,
        releasedAt: signoff.released_at ? fmtDateAU(signoff.released_at as string) : null,
        summary: (signoff.summary as string | null) ?? '',
      }}
      company={toDocCompany((settings ?? null) as SettingsRow | null)}
      lines={pdfLines}
      photos={photos}
      response={pdfResponse}
      watermark={opts.watermark ?? null}
    />
  )

  const versionSuffix = Number(signoff.version) > 1 ? `-v${signoff.version}` : ''
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="Signoff-${work.number}-${date}${versionSuffix}.pdf"`,
    },
  })
}
