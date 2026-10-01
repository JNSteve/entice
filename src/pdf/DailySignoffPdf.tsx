import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles } from './theme'
import {
  SIGNOFF_SECTIONS,
  SIGNOFF_SECTION_LABELS,
  SIGNOFF_STATUS_LABELS,
  fmtQty,
  type SignoffSection,
  type SignoffStatus,
} from '@/lib/signoffs'

export type DailySignoffPdfDispute = {
  client_qty: number
  reason: string
}

export type DailySignoffPdfLine = {
  id: string
  section: SignoffSection
  description: string
  qty: number
  unit: string
  detail: string | null
  scope_label: string | null
  /** Present only when the client disputed this line. */
  dispute: DailySignoffPdfDispute | null
}

export type DailySignoffPdfPhoto = {
  /** Signed https URL (or data URL) — must be PNG/JPEG for react-pdf. */
  url: string
  caption: string | null
}

export type DailySignoffPdfResponse = {
  signerName: string
  /** Pre-formatted, e.g. "02/10/2026 16:42". */
  signedAt: string
  /** PNG data URL captured on the portal. */
  signatureData: string
  ip: string | null
  disputeCount: number
}

export type DailySignoffPdfSheet = {
  workNumber: string
  workTitle: string
  clientName: string | null
  siteName: string | null
  /** Pre-formatted day, e.g. "Thursday 02/10/2026". */
  day: string
  version: number
  status: SignoffStatus
  /** Pre-formatted release date, e.g. "02/10/2026". */
  releasedAt: string | null
  summary: string
}

export type DailySignoffPdfProps = {
  sheet: DailySignoffPdfSheet
  company: DocCompany
  lines: DailySignoffPdfLine[]
  photos: DailySignoffPdfPhoto[]
  response: DailySignoffPdfResponse | null
  watermark?: string | null
}

const MAX_PHOTOS = 12

const styles = StyleSheet.create({
  details: {
    marginBottom: 14,
    gap: 3,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  detailLabel: {
    width: 60,
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: 1,
  },
  detailValue: {
    flex: 1,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  section: {
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  sectionText: {
    fontSize: fontSize.base,
    color: palette.slate900,
    lineHeight: 1.5,
  },
  itemSub: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 1,
  },
  disputedRow: {
    backgroundColor: '#fde8e8',
  },
  disputeText: {
    fontSize: fontSize.base,
    color: '#9b1c1c',
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoCell: {
    width: '32%',
    flexDirection: 'column',
    gap: 2,
  },
  photoImage: {
    width: '100%',
    height: 120,
    objectFit: 'cover',
    borderRadius: 2,
    backgroundColor: palette.slate100,
  },
  photoCaption: {
    fontSize: fontSize.xs,
    color: palette.slate700,
  },
  signBlock: {
    marginTop: 4,
    marginBottom: 12,
    padding: 10,
    borderWidth: 0.5,
    borderColor: palette.slate300,
    borderRadius: 2,
    gap: 4,
  },
  signLine: {
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  signStrong: {
    fontFamily: font.bold,
  },
  signature: {
    width: 180,
    height: 60,
    objectFit: 'contain',
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate400,
  },
  signSmall: {
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
  awaiting: {
    fontSize: fontSize.md,
    color: palette.slate700,
    fontFamily: font.oblique,
  },
  draft: {
    fontSize: fontSize.md,
    color: '#9b1c1c',
    fontFamily: font.bold,
  },
  wording: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    marginTop: 4,
  },
})

const colPlain = StyleSheet.create({
  item: { width: '70%', paddingRight: 8 },
  qty: { width: '15%' },
  unit: { width: '15%', paddingLeft: 8 },
})

const colDisputed = StyleSheet.create({
  item: { width: '40%', paddingRight: 8 },
  qty: { width: '10%' },
  unit: { width: '10%', paddingLeft: 6 },
  clientQty: { width: '12%' },
  clientNote: { width: '28%', paddingLeft: 8 },
})

function statusLine(sheet: DailySignoffPdfSheet, response: DailySignoffPdfResponse | null) {
  switch (sheet.status) {
    case 'released':
      return sheet.releasedAt ? `Released ${sheet.releasedAt}` : SIGNOFF_STATUS_LABELS.released
    case 'signed':
    case 'disputed':
      return response
        ? `${SIGNOFF_STATUS_LABELS[sheet.status]} ${response.signedAt}`
        : SIGNOFF_STATUS_LABELS[sheet.status]
    default:
      return SIGNOFF_STATUS_LABELS[sheet.status]
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

function SectionTable({
  section,
  lines,
  hasDisputes,
}: {
  section: SignoffSection
  lines: DailySignoffPdfLine[]
  hasDisputes: boolean
}) {
  if (lines.length === 0) return null
  const col = hasDisputes ? colDisputed : colPlain

  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.sectionTitleRow} wrap={false}>
        <Text style={tableStyles.sectionTitle}>{SIGNOFF_SECTION_LABELS[section]}</Text>
      </View>
      <View style={tableStyles.headRow} wrap={false}>
        <Text style={[tableStyles.headCell, col.item]}>Item</Text>
        <Text style={[tableStyles.headCell, col.qty, tableStyles.right]}>Qty</Text>
        <Text style={[tableStyles.headCell, col.unit]}>Unit</Text>
        {hasDisputes ? (
          <>
            <Text style={[tableStyles.headCell, colDisputed.clientQty, tableStyles.right]}>
              Client qty
            </Text>
            <Text style={[tableStyles.headCell, colDisputed.clientNote]}>Client note</Text>
          </>
        ) : null}
      </View>
      {lines.map((l) => (
        <View
          key={l.id}
          style={l.dispute ? [tableStyles.row, styles.disputedRow] : tableStyles.row}
          wrap={false}
        >
          <View style={col.item}>
            <Text style={tableStyles.cell}>{l.description}</Text>
            {l.detail ? <Text style={styles.itemSub}>{l.detail}</Text> : null}
            {l.scope_label ? (
              <Text style={styles.itemSub}>Scope: {l.scope_label}</Text>
            ) : null}
          </View>
          <Text style={[tableStyles.cell, col.qty, tableStyles.right]}>{fmtQty(l.qty)}</Text>
          <Text style={[tableStyles.cellMuted, col.unit]}>{l.unit}</Text>
          {hasDisputes ? (
            <>
              <Text style={[styles.disputeText, colDisputed.clientQty, tableStyles.right]}>
                {l.dispute ? fmtQty(l.dispute.client_qty) : ''}
              </Text>
              <Text style={[styles.disputeText, colDisputed.clientNote]}>
                {l.dispute ? l.dispute.reason : ''}
              </Text>
            </>
          ) : null}
        </View>
      ))}
    </View>
  )
}

function PhotoGrid({ photos }: { photos: DailySignoffPdfPhoto[] }) {
  const shown = photos.slice(0, MAX_PHOTOS)
  if (shown.length === 0) return null
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Photos</Text>
      <View style={styles.photoGrid}>
        {shown.map((photo, i) => (
          <View key={i} style={styles.photoCell} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            <Image src={photo.url} style={styles.photoImage} />
            {photo.caption ? <Text style={styles.photoCaption}>{photo.caption}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  )
}

function SignoffBlock({
  status,
  response,
}: {
  status: SignoffStatus
  response: DailySignoffPdfResponse | null
}) {
  let body
  if (response) {
    body = (
      <>
        <Text style={styles.signLine}>
          Signed by <Text style={styles.signStrong}>{response.signerName}</Text> on{' '}
          {response.signedAt}
          {response.disputeCount > 0
            ? ` with ${response.disputeCount} disputed line${response.disputeCount === 1 ? '' : 's'}`
            : ''}
        </Text>
        {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
        <Image src={response.signatureData} style={styles.signature} />
        {response.ip ? <Text style={styles.signSmall}>IP {response.ip}</Text> : null}
      </>
    )
  } else if (status === 'draft') {
    body = <Text style={styles.draft}>DRAFT — not released to the client</Text>
  } else if (status === 'released') {
    body = <Text style={styles.awaiting}>Awaiting client signature</Text>
  } else {
    body = <Text style={styles.awaiting}>{SIGNOFF_STATUS_LABELS[status]}</Text>
  }

  return (
    <View style={styles.signBlock} wrap={false}>
      <Text style={styles.sectionLabel}>Client sign-off</Text>
      {body}
    </View>
  )
}

/**
 * Daily field sign-off sheet: the frozen record of labour, subcontractors,
 * plant and materials on site for one day, with the client's signature or
 * disputes. Quantities only — never rates or amounts.
 */
export function DailySignoffPdf({
  sheet,
  company,
  lines,
  photos,
  response,
  watermark,
}: DailySignoffPdfProps) {
  const hasDisputes = lines.some((l) => l.dispute)
  const docNumber = `${sheet.workNumber}${sheet.version > 1 ? ` v${sheet.version}` : ''}`

  return (
    <DocShell
      title="Daily Sign-off"
      docNumber={docNumber}
      docDate={sheet.day}
      company={company}
      watermark={watermark ?? null}
    >
      <View style={styles.details}>
        <Detail label="Work" value={`${sheet.workNumber} — ${sheet.workTitle}`} />
        <Detail label="Client" value={sheet.clientName ?? '—'} />
        <Detail label="Site" value={sheet.siteName ?? '—'} />
        <Detail label="Day" value={sheet.day} />
        <Detail label="Status" value={statusLine(sheet, response)} />
      </View>

      {sheet.summary.trim() ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Work carried out</Text>
          <Text style={styles.sectionText}>{sheet.summary}</Text>
        </View>
      ) : null}

      {SIGNOFF_SECTIONS.map((section) => (
        <SectionTable
          key={section}
          section={section}
          lines={lines.filter((l) => l.section === section)}
          hasDisputes={hasDisputes}
        />
      ))}

      <PhotoGrid photos={photos} />

      <SignoffBlock status={sheet.status} response={response} />

      <Text style={styles.wording}>
        Quantities only. This record confirms labour, plant and materials on site for the
        day; it is not an invoice.
      </Text>
    </DocShell>
  )
}
