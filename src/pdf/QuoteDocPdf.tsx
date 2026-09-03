import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { stripLeadingOrdinal, type DetailRow, type DocBlock, type QuoteDoc } from '@/lib/quote-doc'
import type { PricingModel } from '@/lib/quote-pricing'
import { DocShell, type DocCompany } from './DocShell'
import { PricingBlock } from './quote-pricing'
import type { QuotePdfAcceptance } from './QuotePdf'
import { palette, fontSize, font, tableStyles } from './theme'

export type QuoteDocPdfProps = {
  quote: { number: string; title: string; date: string }
  company: DocCompany
  /** Merge fields already applied (mergeDoc). */
  doc: QuoteDoc
  details: DetailRow[]
  pricing: PricingModel
  quoteFooter?: string | null
  acceptance?: QuotePdfAcceptance | null
  watermark?: string | null
}

const styles = StyleSheet.create({
  serviceHeading: { fontFamily: font.bold, fontSize: fontSize.xl, color: palette.navy },
  jobLine: { fontSize: fontSize.md, color: palette.slate700, marginTop: 2, marginBottom: 12 },
  details: {
    borderTopWidth: 0.75,
    borderBottomWidth: 0.75,
    borderColor: palette.slate300,
    paddingVertical: 6,
    marginBottom: 6,
  },
  detailRow: { flexDirection: 'row', paddingVertical: 2.5 },
  detailLabel: {
    width: '20%',
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingTop: 1,
  },
  detailValue: { width: '80%', fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.4 },
  h: {
    fontFamily: font.bold,
    fontSize: fontSize.lg,
    color: palette.navy,
    marginTop: 14,
    marginBottom: 6,
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: palette.slate300,
  },
  p: { fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.5, marginBottom: 6 },
  bulletRow: { flexDirection: 'row', gap: 6, marginBottom: 3, paddingRight: 8 },
  bulletMark: { width: 8, fontSize: fontSize.base, color: palette.slate500 },
  bulletText: { flex: 1, fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.5 },
  colLabel: { width: '30%', paddingRight: 8 },
  colValue: { width: '70%' },
  cellLabel: { fontFamily: font.bold, fontSize: fontSize.base, color: palette.slate700, lineHeight: 1.45 },
  cellValue: { fontSize: fontSize.base, color: palette.slate900, lineHeight: 1.45 },
  feeNote: { fontSize: fontSize.sm, color: palette.slate500, lineHeight: 1.5, marginTop: 6 },
  signGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10, gap: 12 },
  signCell: {
    width: '47%',
    borderBottomWidth: 0.75,
    borderBottomColor: palette.slate400,
    paddingBottom: 4,
    marginBottom: 8,
  },
  signCellTall: { height: 48 },
  signLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.xs,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  quoteFooter: { fontSize: fontSize.sm, color: palette.slate500, lineHeight: 1.5, marginTop: 14 },
  acceptanceBlock: {
    marginTop: 10,
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
  acceptanceLine: { fontSize: fontSize.base, color: palette.slate700 },
  acceptanceSignature: {
    width: 180,
    height: 60,
    objectFit: 'contain',
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: palette.slate300,
  },
})

function Heading({ n, text }: { n: number | null; text: string }) {
  // Numbering off: the heading keeps whatever numbers the author typed.
  return (
    <Text style={styles.h} minPresenceAhead={80}>
      {n === null ? text : `${n}. ${stripLeadingOrdinal(text)}`}
    </Text>
  )
}

function Paragraphs({ body }: { body: string }) {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  return (
    <>
      {paras.map((p, i) => (
        <Text key={i} style={styles.p}>
          {p}
        </Text>
      ))}
    </>
  )
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ marginBottom: 4 }}>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletMark}>•</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  )
}

function TwoColTable({ columns, rows }: { columns: [string, string]; rows: { label: string; value: string }[] }) {
  return (
    <View style={tableStyles.table} wrap>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, styles.colLabel]}>{columns[0]}</Text>
        <Text style={[tableStyles.headCell, styles.colValue]}>{columns[1]}</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[styles.cellLabel, styles.colLabel]}>{r.label}</Text>
          <Text style={[styles.cellValue, styles.colValue]}>{r.value}</Text>
        </View>
      ))}
    </View>
  )
}

function SignBlock() {
  const cell = (label: string, tall = false) => (
    <View style={[styles.signCell, tall ? styles.signCellTall : {}]}>
      <Text style={styles.signLabel}>{label}</Text>
    </View>
  )
  return (
    <View style={styles.signGrid} wrap={false}>
      {cell('Accepted by')}
      {cell('Company and PO no.')}
      {cell('Signature', true)}
      {cell('Date', true)}
    </View>
  )
}

function PortalEvidence({ acceptance, clientLine }: { acceptance: QuotePdfAcceptance; clientLine: string }) {
  return (
    <View style={styles.acceptanceBlock} wrap={false}>
      <Text style={styles.acceptanceTitle}>Accepted via client portal</Text>
      <Text style={styles.acceptanceLine}>Accepted by {acceptance.signerName}{clientLine}</Text>
      <Text style={styles.acceptanceLine}>{acceptance.signedAtDisplay}</Text>
      {acceptance.signatureUrl ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
        <Image src={acceptance.signatureUrl} style={styles.acceptanceSignature} />
      ) : null}
    </View>
  )
}

function Block({ block, n, pricing, acceptance }: { block: DocBlock; n: number | null; pricing: PricingModel; acceptance: QuotePdfAcceptance | null }) {
  switch (block.type) {
    case 'text':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <Paragraphs body={block.body} />
        </View>
      )
    case 'bullets':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <Bullets items={block.items} />
        </View>
      )
    case 'table':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          {block.intro ? <Paragraphs body={block.intro} /> : null}
          <TwoColTable columns={block.columns} rows={block.rows} />
        </View>
      )
    case 'pricing':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <PricingBlock model={pricing} />
          {block.note ? <Text style={styles.feeNote}>{block.note}</Text> : null}
        </View>
      )
    case 'acceptance':
      return (
        <View>
          <Heading n={n} text={block.heading} />
          <Paragraphs body={block.body} />
          {acceptance ? <PortalEvidence acceptance={acceptance} clientLine="" /> : <SignBlock />}
        </View>
      )
  }
}

/**
 * Templated client-facing quotation (quotes.doc snapshot). Sell side only —
 * the pricing model carries no cost or markup by construction.
 */
export function QuoteDocPdf({ quote, company, doc, details, pricing, quoteFooter, acceptance, watermark }: QuoteDocPdfProps) {
  const hasAcceptanceBlock = doc.blocks.some((b) => b.type === 'acceptance')
  return (
    <DocShell title={doc.doc_title} docNumber={quote.number} docDate={quote.date} company={company} watermark={watermark}>
      {doc.heading ? <Text style={styles.serviceHeading}>{doc.heading}</Text> : null}
      <Text style={[styles.jobLine, doc.heading ? {} : { fontFamily: font.bold, fontSize: fontSize.xl, color: palette.navy }]}>
        {quote.title}
      </Text>

      <View style={styles.details}>
        {details.map((d, i) => (
          <View key={i} style={styles.detailRow}>
            <Text style={styles.detailLabel}>{d.label}</Text>
            <Text style={styles.detailValue}>{d.value}</Text>
          </View>
        ))}
      </View>

      {doc.blocks.map((block, i) => (
        <Block
          key={block.id}
          block={block}
          n={doc.number_headings ? i + 1 : null}
          pricing={pricing}
          acceptance={acceptance ?? null}
        />
      ))}

      {!hasAcceptanceBlock && acceptance ? <PortalEvidence acceptance={acceptance} clientLine="" /> : null}

      {quoteFooter ? <Text style={styles.quoteFooter}>{quoteFooter}</Text> : null}
    </DocShell>
  )
}
