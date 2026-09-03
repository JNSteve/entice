import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { DEFAULT_PRICING, type PricingDisplay } from '@/lib/quote-doc'
import { buildPricingModel, type PricingLine, type PricingSection } from '@/lib/quote-pricing'
import { DocShell, type DocCompany } from './DocShell'
import { PricingBlock } from './quote-pricing'
import { palette, fontSize, font } from './theme'

export type QuotePdfLine = PricingLine
export type QuotePdfSection = PricingSection

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
  /** Settings → Quote footer: fine print printed under the validity line. */
  quoteFooter?: string | null
  footerText?: string | null
  acceptance?: QuotePdfAcceptance | null
  /** "Issued to {client} — {date}" banner for portal-issued copies. */
  watermark?: string | null
  /** Pricing presentation (quotes.pdf_options); defaults to the itemised table. */
  display?: PricingDisplay
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
  quoteFooter: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    lineHeight: 1.5,
    marginTop: 6,
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
  quoteFooter,
  footerText,
  acceptance,
  watermark,
  display = DEFAULT_PRICING,
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

      <PricingBlock model={buildPricingModel(sections, totals, display)} />

      <Text style={styles.validity}>
        This quotation is valid for {validDays} days from the date above.
      </Text>

      {quoteFooter ? (
        <Text style={styles.quoteFooter}>{quoteFooter}</Text>
      ) : null}

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
