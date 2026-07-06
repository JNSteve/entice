import { View, Text, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, tableStyles } from './theme'

/**
 * Handover Pack (CP3) — the one-document closeout dossier for a COMPLETED
 * job or project: cover summary, the property's compliance register at
 * completion, quality hold-point releases + lot conformance (projects with
 * lots), the waste disposal record, an index of the client-shared documents
 * and the issued billing history. Referenced documents are LISTED (name +
 * date), never embedded — the portal serves the files themselves.
 */

export type HandoverPdfRow = { label: string; value: string }

export type HandoverComplianceRow = {
  kind: string
  title: string
  issued: string
  reviewDue: string | null
  evidence: string | null
}

export type HandoverHoldPointRow = {
  lot: string
  title: string
  status: string
  released: string | null
  releaseRef: string | null
}

export type HandoverLotRow = {
  number: string
  description: string
  status: string
}

export type HandoverWasteRow = {
  number: string
  date: string
  classification: string
  qty: string
  facility: string | null
  docket: string | null
}

export type HandoverDocumentRow = {
  name: string
  date: string
  context: string
}

export type HandoverBillingRow = {
  number: string
  date: string
  status: string
  amount: string | null
}

export type HandoverPdfProps = {
  company: DocCompany
  pack: {
    number: string
    title: string
    kindLabel: string
    clientName: string
    propertyName: string | null
    propertyAddress: string | null
    description: string | null
    dates: HandoverPdfRow[]
    generatedDate: string
  }
  compliance: HandoverComplianceRow[]
  holdPoints: HandoverHoldPointRow[]
  lots: HandoverLotRow[]
  waste: HandoverWasteRow[]
  documents: HandoverDocumentRow[]
  billing: HandoverBillingRow[]
  /** Whether billing amounts are included (any active portal link shows financials). */
  showAmounts: boolean
}

const styles = StyleSheet.create({
  sectionGap: { marginTop: 4, marginBottom: 14 },
  coverRow: { flexDirection: 'row', paddingVertical: 3 },
  coverLabel: {
    width: 110,
    fontSize: fontSize.base,
    color: palette.slate500,
  },
  coverValue: {
    flex: 1,
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  intro: {
    fontSize: fontSize.base,
    color: palette.slate700,
    lineHeight: 1.5,
    marginBottom: 12,
  },
  empty: {
    fontSize: fontSize.base,
    color: palette.slate500,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  note: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 4,
  },
})

const col = StyleSheet.create({
  kind: { width: 105 },
  title: { flex: 1 },
  date: { width: 62 },
  evidence: { width: 120 },
  lotNum: { width: 66 },
  lotStatus: { width: 78 },
  ref: { width: 90 },
  wasteNum: { width: 62 },
  qty: { width: 54, textAlign: 'right' as const, paddingRight: 4 },
  facility: { width: 110, paddingLeft: 8 },
  docket: { width: 70 },
  docName: { flex: 1 },
  docContext: { width: 170 },
  billNum: { flex: 1 },
  amount: { width: 80, textAlign: 'right' as const },
  status: { width: 70 },
})

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.sectionGap}>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

function Empty({ children }: { children: string }) {
  return <Text style={styles.empty}>{children}</Text>
}

export function HandoverPdf({
  company,
  pack,
  compliance,
  holdPoints,
  lots,
  waste,
  documents,
  billing,
  showAmounts,
}: HandoverPdfProps) {
  const coverRows: HandoverPdfRow[] = [
    { label: 'Client', value: pack.clientName },
    { label: 'Property', value: pack.propertyName ?? '—' },
    ...(pack.propertyAddress ? [{ label: 'Address', value: pack.propertyAddress }] : []),
    { label: pack.kindLabel, value: `${pack.number} — ${pack.title}` },
    ...pack.dates,
  ]

  return (
    <DocShell
      title="Handover Pack"
      docNumber={pack.number}
      docDate={pack.generatedDate}
      company={company}
      footerText={
        'Handover pack — a summary of the compliance, quality, waste and document records held for this work. ' +
        'Listed documents are available through your client portal or on request.'
      }
    >
      {/* ── Cover / works summary ─────────────────────────────────────────── */}
      <Section title="Works summary">
        <View style={{ paddingHorizontal: 8, paddingTop: 4 }}>
          {coverRows.map((row, i) => (
            <View key={i} style={styles.coverRow}>
              <Text style={styles.coverLabel}>{row.label}</Text>
              <Text style={styles.coverValue}>{row.value}</Text>
            </View>
          ))}
          {pack.description ? (
            <View style={styles.coverRow}>
              <Text style={styles.coverLabel}>Scope</Text>
              <Text style={styles.coverValue}>{pack.description}</Text>
            </View>
          ) : null}
        </View>
      </Section>

      {/* ── Property compliance at completion ─────────────────────────────── */}
      <Section title="Property compliance at handover">
        {compliance.length === 0 ? (
          <Empty>No compliance items on record for this property.</Empty>
        ) : (
          <>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, col.kind]}>Type</Text>
              <Text style={[tableStyles.headCell, col.title]}>Item</Text>
              <Text style={[tableStyles.headCell, col.date]}>Issued</Text>
              <Text style={[tableStyles.headCell, col.date]}>Review due</Text>
              <Text style={[tableStyles.headCell, col.evidence]}>Document</Text>
            </View>
            {compliance.map((row, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cellMuted, col.kind]}>{row.kind}</Text>
                <Text style={[tableStyles.cell, col.title]}>{row.title}</Text>
                <Text style={[tableStyles.cellMuted, col.date]}>{row.issued}</Text>
                <Text style={[tableStyles.cellMuted, col.date]}>
                  {row.reviewDue ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, col.evidence]}>
                  {row.evidence ?? '—'}
                </Text>
              </View>
            ))}
          </>
        )}
      </Section>

      {/* ── Quality: hold-point releases + lot conformance (when present) ──── */}
      {(holdPoints.length > 0 || lots.length > 0) && (
        <Section title="Quality — hold points and lot conformance">
          {holdPoints.length > 0 && (
            <>
              <View style={tableStyles.headRow}>
                <Text style={[tableStyles.headCell, col.lotNum]}>Lot</Text>
                <Text style={[tableStyles.headCell, col.title]}>Hold point</Text>
                <Text style={[tableStyles.headCell, col.lotStatus]}>Status</Text>
                <Text style={[tableStyles.headCell, col.date]}>Released</Text>
                <Text style={[tableStyles.headCell, col.ref]}>Release ref</Text>
              </View>
              {holdPoints.map((hp, i) => (
                <View key={i} style={tableStyles.row} wrap={false}>
                  <Text style={[tableStyles.cellMuted, col.lotNum]}>{hp.lot}</Text>
                  <Text style={[tableStyles.cell, col.title]}>{hp.title}</Text>
                  <Text style={[tableStyles.cell, col.lotStatus]}>{hp.status}</Text>
                  <Text style={[tableStyles.cellMuted, col.date]}>
                    {hp.released ?? '—'}
                  </Text>
                  <Text style={[tableStyles.cellMuted, col.ref]}>
                    {hp.releaseRef ?? '—'}
                  </Text>
                </View>
              ))}
            </>
          )}
          {lots.length > 0 && (
            <>
              <View style={[tableStyles.headRow, holdPoints.length > 0 ? { marginTop: 8 } : {}]}>
                <Text style={[tableStyles.headCell, col.lotNum]}>Lot</Text>
                <Text style={[tableStyles.headCell, col.title]}>Work covered</Text>
                <Text style={[tableStyles.headCell, col.lotStatus]}>Verdict</Text>
              </View>
              {lots.map((lot, i) => (
                <View key={i} style={tableStyles.row} wrap={false}>
                  <Text style={[tableStyles.cellMuted, col.lotNum]}>{lot.number}</Text>
                  <Text style={[tableStyles.cell, col.title]}>{lot.description}</Text>
                  <Text style={[tableStyles.cell, col.lotStatus]}>{lot.status}</Text>
                </View>
              ))}
            </>
          )}
        </Section>
      )}

      {/* ── Waste disposal record ─────────────────────────────────────────── */}
      <Section title="Waste disposal record">
        {waste.length === 0 ? (
          <Empty>No waste loads recorded against this work.</Empty>
        ) : (
          <>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, col.wasteNum]}>Load</Text>
              <Text style={[tableStyles.headCell, col.date]}>Date</Text>
              <Text style={[tableStyles.headCell, col.title]}>Classification</Text>
              <Text style={[tableStyles.headCell, col.qty]}>Qty</Text>
              <Text style={[tableStyles.headCell, col.facility]}>Facility</Text>
              <Text style={[tableStyles.headCell, col.docket]}>Docket</Text>
            </View>
            {waste.map((row, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cellMuted, col.wasteNum]}>{row.number}</Text>
                <Text style={[tableStyles.cellMuted, col.date]}>{row.date}</Text>
                <Text style={[tableStyles.cell, col.title]}>{row.classification}</Text>
                <Text style={[tableStyles.cell, col.qty]}>{row.qty}</Text>
                <Text style={[tableStyles.cellMuted, col.facility]}>
                  {row.facility ?? '—'}
                </Text>
                <Text style={[tableStyles.cellMuted, col.docket]}>
                  {row.docket ?? '—'}
                </Text>
              </View>
            ))}
          </>
        )}
      </Section>

      {/* ── Documents index ───────────────────────────────────────────────── */}
      <Section title="Documents index">
        {documents.length === 0 ? (
          <Empty>No shared documents on record for this work.</Empty>
        ) : (
          <>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, col.docName]}>Document</Text>
              <Text style={[tableStyles.headCell, col.docContext]}>Source</Text>
              <Text style={[tableStyles.headCell, col.date]}>Date</Text>
            </View>
            {documents.map((doc, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, col.docName]}>{doc.name}</Text>
                <Text style={[tableStyles.cellMuted, col.docContext]}>{doc.context}</Text>
                <Text style={[tableStyles.cellMuted, col.date]}>{doc.date}</Text>
              </View>
            ))}
            <Text style={styles.note}>
              Documents are listed for reference — the files themselves are
              available through your client portal.
            </Text>
          </>
        )}
      </Section>

      {/* ── Billing summary ───────────────────────────────────────────────── */}
      <Section title="Billing summary">
        {billing.length === 0 ? (
          <Empty>No issued invoices or claims recorded for this work.</Empty>
        ) : (
          <>
            <View style={tableStyles.headRow}>
              <Text style={[tableStyles.headCell, col.billNum]}>Document</Text>
              <Text style={[tableStyles.headCell, col.date]}>Date</Text>
              <Text style={[tableStyles.headCell, col.status]}>Status</Text>
              {showAmounts && (
                <Text style={[tableStyles.headCell, col.amount]}>Amount</Text>
              )}
            </View>
            {billing.map((row, i) => (
              <View key={i} style={tableStyles.row} wrap={false}>
                <Text style={[tableStyles.cell, col.billNum]}>{row.number}</Text>
                <Text style={[tableStyles.cellMuted, col.date]}>{row.date}</Text>
                <Text style={[tableStyles.cellMuted, col.status]}>{row.status}</Text>
                {showAmounts && (
                  <Text style={[tableStyles.cell, col.amount]}>
                    {row.amount ?? '—'}
                  </Text>
                )}
              </View>
            ))}
            {!showAmounts && (
              <Text style={styles.note}>
                Issued documents are listed by number and date. Amounts are
                available on the documents themselves.
              </Text>
            )}
          </>
        )}
      </Section>
    </DocShell>
  )
}
