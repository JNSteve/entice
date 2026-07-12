import { Image, Text, View, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, tableStyles, totalsStyles } from './theme'

/**
 * Takeoff schedule — the audit trail of measured quantities behind a quote.
 * Groups measured/manual/report/assembly items by section, showing per-item
 * rate and amount, section subtotals and a grand cost/sell block. Money
 * document — office/admin only, like the quote.
 */

const NEGATIVE_COLOR = '#dc2626'

export interface TakeoffItemRow {
  description: string
  qtyDisplay: string
  unit: string
  source: string
  rateDisplay: string
  amountDisplay: string
  negative: boolean
}

export interface TakeoffGroup {
  title: string
  items: TakeoffItemRow[]
  subtotalDisplay: string
}

export interface TakeoffPdfSheet {
  name: string
  /** PNG bytes of the marked-up plan snapshot. */
  image: Buffer
}

export interface TakeoffPdfData {
  quoteNumber: string
  title: string | null
  generatedDisplay: string
  sheets: TakeoffPdfSheet[]
  groups: TakeoffGroup[]
  totalCostDisplay: string
  totalSellDisplay: string
}

const styles = StyleSheet.create({
  intro: {
    fontSize: fontSize.base,
    color: palette.slate700,
    marginBottom: 12,
  },
  sheetBlock: {
    marginBottom: 14,
  },
  sheetName: {
    fontSize: fontSize.base,
    fontWeight: 700,
    color: palette.slate900,
    marginBottom: 4,
  },
  sheetImage: {
    width: '100%',
    borderRadius: 4,
    border: `1 solid ${palette.slate200}`,
  },
})

const COL = {
  description: { flex: 1 },
  qty: { width: 54 },
  unit: { width: 40 },
  source: { width: 130 },
  rate: { width: 60 },
  amount: { width: 66 },
}

export function TakeoffPdf({
  data,
  company,
}: {
  data: TakeoffPdfData
  company: DocCompany
}) {
  return (
    <DocShell
      title="Takeoff schedule"
      docNumber={data.quoteNumber}
      docDate={data.generatedDisplay}
      company={company}
      footerText={`Takeoff schedule for quote ${data.quoteNumber}${data.title ? ` — ${data.title}` : ''}. Measured quantities and estimating audit trail prepared by ${company.name}.`}
    >
      <Text style={styles.intro}>
        Measured and estimated quantities behind quote {data.quoteNumber}
        {data.title ? ` — ${data.title}` : ''}, as at {data.generatedDisplay}.
      </Text>

      {data.sheets.map((sheet, i) => (
        <View key={`sheet-${i}`} style={styles.sheetBlock} wrap={false}>
          <Text style={styles.sheetName}>{sheet.name}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- @react-pdf Image */}
          <Image style={styles.sheetImage} src={{ data: sheet.image, format: 'png' }} />
        </View>
      ))}

      {data.groups.map((group, i) => (
        <View key={i} style={tableStyles.table} wrap={group.items.length > 12}>
          <View style={tableStyles.sectionTitleRow}>
            <Text style={tableStyles.sectionTitle}>{group.title}</Text>
          </View>
          <View style={tableStyles.headRow}>
            <Text style={[tableStyles.headCell, COL.description]}>Description</Text>
            <Text style={[tableStyles.headCell, COL.qty, tableStyles.right]}>Qty</Text>
            <Text style={[tableStyles.headCell, COL.unit]}>Unit</Text>
            <Text style={[tableStyles.headCell, COL.source]}>Source</Text>
            <Text style={[tableStyles.headCell, COL.rate, tableStyles.right]}>Rate</Text>
            <Text style={[tableStyles.headCell, COL.amount, tableStyles.right]}>Amount</Text>
          </View>
          {group.items.map((item, j) => (
            <View key={j} style={tableStyles.row}>
              <Text style={[tableStyles.cell, COL.description]}>
                {item.description}
              </Text>
              <Text
                style={[
                  tableStyles.cell,
                  COL.qty,
                  tableStyles.right,
                  item.negative ? { color: NEGATIVE_COLOR } : {},
                ]}
              >
                {item.qtyDisplay}
              </Text>
              <Text style={[tableStyles.cellMuted, COL.unit]}>{item.unit}</Text>
              <Text style={[tableStyles.cellMuted, COL.source]}>{item.source}</Text>
              <Text style={[tableStyles.cell, COL.rate, tableStyles.right]}>
                {item.rateDisplay}
              </Text>
              <Text
                style={[
                  tableStyles.cell,
                  COL.amount,
                  tableStyles.right,
                  item.negative ? { color: NEGATIVE_COLOR } : {},
                ]}
              >
                {item.amountDisplay}
              </Text>
            </View>
          ))}
          <View style={tableStyles.subtotalRow}>
            <Text style={tableStyles.subtotalLabel}>Section cost</Text>
            <Text style={tableStyles.subtotalValue}>{group.subtotalDisplay}</Text>
          </View>
        </View>
      ))}

      <View style={totalsStyles.block}>
        <View style={totalsStyles.row}>
          <Text style={totalsStyles.label}>Total cost</Text>
          <Text style={totalsStyles.value}>{data.totalCostDisplay}</Text>
        </View>
        <View style={totalsStyles.grandRow}>
          <Text style={totalsStyles.grandLabel}>Total sell</Text>
          <Text style={totalsStyles.grandValue}>{data.totalSellDisplay}</Text>
        </View>
      </View>
    </DocShell>
  )
}
