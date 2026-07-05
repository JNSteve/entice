import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { aud, pct } from '@/lib/format'
import { lineTotal } from '@/lib/money'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, font, tableStyles, totalsStyles } from './theme'

export type QuotePdfLine = {
  description: string
  qty: number
  unit: string
  unit_sell: number
}

export type QuotePdfSection = {
  title: string
  lines: QuotePdfLine[]
}

/** Sign-on-the-glass evidence rendered when the quote was accepted online. */
export type QuotePdfAcceptance = {
  signerName: string
  /** Pre-formatted display datetime (Brisbane). */
  signedAtDisplay: string
  /** PNG data URL from the portal signature pad. */
  signatureUrl: string | null
}

export type QuotePdfProps = {
  quote: {
    number: string
    title: string
    /** Pre-formatted display date. */
    date: string
    clientName: string
    contactName?: string | null
    siteName?: string | null
    siteAddress?: string | null
  }
  company: DocCompany
  sections: QuotePdfSection[]
  totals: { subtotal: number; gst: number; gstRate: number; total: number }
  validDays: number
  description?: string | null
  footerText?: string | null
  acceptance?: QuotePdfAcceptance | null
  /** "Issued to {client} — {date}" banner for portal-issued copies. */
  watermark?: string | null
}

const styles = StyleSheet.create({
  toBlock: {
    marginBottom: 14,
    gap: 2,
  },
  toLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  toName: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate900,
  },
  toLine: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  subject: {
    fontFamily: font.bold,
    fontSize: fontSize.lg,
    color: palette.navy,
    marginBottom: 6,
  },
  description: {
    fontSize: fontSize.base,
    color: palette.slate700,
    lineHeight: 1.5,
    marginBottom: 14,
  },
  validity: {
    fontFamily: font.oblique,
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 16,
  },
  acceptanceBlock: {
    marginTop: 18,
    borderWidth: 0.75,
    borderColor: palette.slate300,
    borderRadius: 4,
    padding: 12,
    gap: 4,
  },
  acceptanceTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.navy,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  acceptanceLine: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  acceptanceSignature: {
    width: 180,
    height: 60,
    objectFit: 'contain',
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: palette.slate300,
  },
})

// Column widths — Description | Qty | Unit | Rate | Total
const col = StyleSheet.create({
  description: { width: '46%' },
  qty: { width: '10%' },
  unit: { width: '12%' },
  rate: { width: '16%' },
  total: { width: '16%' },
})

/** Trim trailing zeros from a qty (numeric 12,3): 2.000 → "2", 1.250 → "1.25". */
function fmtQty(n: number): string {
  return String(parseFloat(n.toFixed(3)))
}

function SectionTable({ section }: { section: QuotePdfSection }) {
  const subtotal = section.lines.reduce(
    (sum, l) => sum + lineTotal(l.qty, l.unit_sell),
    0
  )

  return (
    <View style={tableStyles.table} wrap>
      <View style={tableStyles.sectionTitleRow} minPresenceAhead={60}>
        <Text style={tableStyles.sectionTitle}>{section.title}</Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, col.description]}>Description</Text>
        <Text style={[tableStyles.headCell, col.qty, tableStyles.right]}>Qty</Text>
        <Text style={[tableStyles.headCell, col.unit, tableStyles.right]}>Unit</Text>
        <Text style={[tableStyles.headCell, col.rate, tableStyles.right]}>Rate</Text>
        <Text style={[tableStyles.headCell, col.total, tableStyles.right]}>Total</Text>
      </View>
      {section.lines.map((line, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, col.description]}>{line.description}</Text>
          <Text style={[tableStyles.cell, col.qty, tableStyles.right]}>{fmtQty(line.qty)}</Text>
          <Text style={[tableStyles.cellMuted, col.unit, tableStyles.right]}>{line.unit}</Text>
          <Text style={[tableStyles.cell, col.rate, tableStyles.right]}>{aud(line.unit_sell)}</Text>
          <Text style={[tableStyles.cell, col.total, tableStyles.right]}>
            {aud(lineTotal(line.qty, line.unit_sell))}
          </Text>
        </View>
      ))}
      <View style={tableStyles.subtotalRow} wrap={false}>
        <Text style={tableStyles.subtotalLabel}>Section subtotal</Text>
        <Text style={tableStyles.subtotalValue}>{aud(subtotal)}</Text>
      </View>
    </View>
  )
}

/**
 * Client-facing quotation. Sell side only — costs and markup are never
 * rendered anywhere in this document.
 */
export function QuotePdf({
  quote,
  company,
  sections,
  totals,
  validDays,
  description,
  footerText,
  acceptance,
  watermark,
}: QuotePdfProps) {
  return (
    <DocShell
      title="Quotation"
      docNumber={quote.number}
      docDate={quote.date}
      company={company}
      footerText={footerText}
      watermark={watermark}
    >
      <View style={styles.toBlock}>
        <Text style={styles.toLabel}>To</Text>
        <Text style={styles.toName}>{quote.clientName}</Text>
        {quote.contactName ? <Text style={styles.toLine}>Attn: {quote.contactName}</Text> : null}
        {quote.siteName || quote.siteAddress ? (
          <Text style={styles.toLine}>
            Site: {[quote.siteName, quote.siteAddress].filter(Boolean).join(' — ')}
          </Text>
        ) : null}
      </View>

      <Text style={styles.subject}>{quote.title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}

      {sections.map((section, i) => (
        <SectionTable key={i} section={section} />
      ))}

      <View style={totalsStyles.block} wrap={false}>
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

      <Text style={styles.validity}>
        This quotation is valid for {validDays} days from the date above.
      </Text>

      {acceptance ? (
        <View style={styles.acceptanceBlock} wrap={false}>
          <Text style={styles.acceptanceTitle}>Accepted via client portal</Text>
          <Text style={styles.acceptanceLine}>
            Accepted by {acceptance.signerName} on behalf of {quote.clientName}
          </Text>
          <Text style={styles.acceptanceLine}>{acceptance.signedAtDisplay}</Text>
          {acceptance.signatureUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
            <Image src={acceptance.signatureUrl} style={styles.acceptanceSignature} />
          ) : null}
        </View>
      ) : null}
    </DocShell>
  )
}
