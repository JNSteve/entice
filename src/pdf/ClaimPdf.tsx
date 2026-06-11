import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { aud, pct } from '@/lib/format'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles, totalsStyles } from './theme'

export type ClaimPdfLine = {
  description: string
  line_value: number
  pct_complete: number
  claimed_to_date: number
  previous_claimed: number
  this_claim: number
}

export type ClaimPdfProps = {
  claim: {
    number: number
    /** Pre-formatted reference date. */
    date: string
    status: string
    projectName: string
    projectNumber: string
    clientName: string
    clientAbn?: string | null
    clientRef?: string | null
    superintendent?: string | null
  }
  company: DocCompany
  contractLines: ClaimPdfLine[]
  variationLines: ClaimPdfLine[]
  totals: {
    gross: number
    retention: number
    retentionHeldToDate: number
    subtotal: number
    gst: number
    gstRate: number
    total: number
  }
  /** settings.claim_footer — SOP Act wording. */
  footerText?: string | null
}

const styles = StyleSheet.create({
  draftBadge: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  toBlock: {
    marginBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
  },
  block: {
    flexDirection: 'column',
    gap: 2,
  },
  blockRight: {
    flexDirection: 'column',
    gap: 2,
    alignItems: 'flex-end',
  },
  blockLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  blockName: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  blockLine: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  retentionNote: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  retentionNoteLabel: {
    fontSize: fontSize.sm,
    color: palette.slate500,
  },
  retentionNoteValue: {
    fontSize: fontSize.sm,
    color: palette.slate500,
  },
  footerPara: {
    fontSize: fontSize.sm,
    color: palette.slate700,
    lineHeight: 1.5,
    marginTop: 16,
    borderTopWidth: 0.5,
    borderTopColor: palette.slate200,
    paddingTop: 8,
  },
  eoe: {
    fontFamily: font.oblique,
    fontSize: fontSize.xs,
    color: palette.slate500,
    marginTop: 8,
  },
})

// Columns — Description | Contract value | % | Claimed to date | Previous | This claim
const col = StyleSheet.create({
  description: { width: '30%' },
  value: { width: '15%' },
  pct: { width: '8%' },
  claimed: { width: '16%' },
  previous: { width: '15%' },
  thisClaim: { width: '16%' },
})

function LineRows({ title, lines }: { title: string; lines: ClaimPdfLine[] }) {
  if (lines.length === 0) return null
  return (
    <>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>{title}</Text>
      </View>
      {lines.map((line, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, col.description]}>{line.description}</Text>
          <Text style={[tableStyles.cell, col.value, tableStyles.right]}>
            {aud(line.line_value)}
          </Text>
          <Text style={[tableStyles.cellMuted, col.pct, tableStyles.right]}>
            {pct(line.pct_complete)}
          </Text>
          <Text style={[tableStyles.cell, col.claimed, tableStyles.right]}>
            {aud(line.claimed_to_date)}
          </Text>
          <Text style={[tableStyles.cellMuted, col.previous, tableStyles.right]}>
            {aud(line.previous_claimed)}
          </Text>
          <Text style={[tableStyles.cell, col.thisClaim, tableStyles.right]}>
            {aud(line.this_claim)}
          </Text>
        </View>
      ))}
    </>
  )
}

/**
 * Progress payment claim on the shared DocShell: claimant/respondent blocks
 * with both ABNs, lines grouped into contract works and variations, retention
 * summary, and the SOP Act wording from settings.claim_footer.
 */
export function ClaimPdf({
  claim,
  company,
  contractLines,
  variationLines,
  totals,
  footerText,
}: ClaimPdfProps) {
  return (
    <DocShell
      title="Payment Claim"
      docNumber={`No. ${claim.number}`}
      docDate={claim.date}
      company={company}
    >
      {claim.status === 'draft' ? (
        <Text style={styles.draftBadge}>Draft — Not yet submitted</Text>
      ) : null}

      <View style={styles.toBlock}>
        <View style={styles.block}>
          <Text style={styles.blockLabel}>To</Text>
          <Text style={styles.blockName}>{claim.clientName}</Text>
          {claim.clientAbn ? (
            <Text style={styles.blockLine}>ABN {claim.clientAbn}</Text>
          ) : null}
          {claim.clientRef ? (
            <Text style={styles.blockLine}>Contract ref: {claim.clientRef}</Text>
          ) : null}
          {claim.superintendent ? (
            <Text style={styles.blockLine}>Superintendent: {claim.superintendent}</Text>
          ) : null}
        </View>
        <View style={styles.blockRight}>
          <Text style={styles.blockLabel}>Project</Text>
          <Text style={styles.blockName}>{claim.projectName}</Text>
          <Text style={styles.blockLine}>{claim.projectNumber}</Text>
        </View>
      </View>

      <View style={tableStyles.table} wrap>
        <View style={tableStyles.headRow}>
          <Text style={[tableStyles.headCell, col.description]}>Description</Text>
          <Text style={[tableStyles.headCell, col.value, tableStyles.right]}>
            Contract value
          </Text>
          <Text style={[tableStyles.headCell, col.pct, tableStyles.right]}>%</Text>
          <Text style={[tableStyles.headCell, col.claimed, tableStyles.right]}>
            Claimed to date
          </Text>
          <Text style={[tableStyles.headCell, col.previous, tableStyles.right]}>
            Previous
          </Text>
          <Text style={[tableStyles.headCell, col.thisClaim, tableStyles.right]}>
            This claim
          </Text>
        </View>
        <LineRows title="Contract works" lines={contractLines} />
        <LineRows title="Variations" lines={variationLines} />
      </View>

      <View style={totalsStyles.block} wrap={false}>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>Gross this claim</Text>
          <Text style={totalsStyles.value}>{aud(totals.gross)}</Text>
        </View>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>Less retention this claim</Text>
          <Text style={totalsStyles.value}>−{aud(totals.retention)}</Text>
        </View>
        <View style={styles.retentionNote}>
          <Text style={styles.retentionNoteLabel}>Retention held to date</Text>
          <Text style={styles.retentionNoteValue}>{aud(totals.retentionHeldToDate)}</Text>
        </View>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>Subtotal (ex GST)</Text>
          <Text style={totalsStyles.value}>{aud(totals.subtotal)}</Text>
        </View>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>GST {pct(totals.gstRate)}</Text>
          <Text style={totalsStyles.value}>{aud(totals.gst)}</Text>
        </View>
        <View style={totalsStyles.grandRow}>
          <Text style={totalsStyles.grandLabel}>Total inc GST</Text>
          <Text style={totalsStyles.grandValue}>{aud(totals.total)}</Text>
        </View>
      </View>

      {footerText ? <Text style={styles.footerPara}>{footerText}</Text> : null}
      <Text style={styles.eoe}>E&OE</Text>
    </DocShell>
  )
}
