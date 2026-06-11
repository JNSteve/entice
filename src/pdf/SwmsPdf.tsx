import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles, tableStyles } from './theme'

export type SwmsPdfHazard = {
  task: string
  hazards: string
  risk: string
  controls: string
  residual_risk: string
}

export type SwmsPdfSignature = {
  name: string
  /** Pre-formatted date, e.g. "12/06/2026". */
  date: string
  version: number
  /** Signed https URL of the PNG, or null when unavailable. */
  imageUrl: string | null
}

export type SwmsPdfProps = {
  swms: {
    title: string
    /** "P-0001 — Riverbank Stabilisation" / "J-0001 — …". */
    parentLabel: string
    version: number
    status: string
    /** Pre-formatted issue date. */
    date: string
  }
  company: DocCompany
  body: string | null
  hazards: SwmsPdfHazard[]
  /** Current-version signatures only. */
  signatures: SwmsPdfSignature[]
  /** Count of signatures pinned to earlier versions. */
  earlierSignatureCount: number
}

const FOOTER_HEIGHT = 46

const styles = StyleSheet.create({
  page: {
    fontFamily: font.regular,
    fontSize: fontSize.base,
    color: palette.slate900,
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: FOOTER_HEIGHT + 24,
    backgroundColor: palette.white,
  },
  footer: {
    position: 'absolute',
    left: 40,
    right: 40,
    bottom: 22,
    borderTopWidth: 0.5,
    borderTopColor: palette.slate300,
    paddingTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  footerText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
  pageNumber: {
    fontSize: fontSize.xs,
    color: palette.slate500,
    flexShrink: 0,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 12,
  },
  metaBlock: {
    flexDirection: 'column',
    gap: 2,
  },
  metaLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  metaValue: {
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
  bodyText: {
    fontSize: fontSize.base,
    color: palette.slate900,
    lineHeight: 1.5,
  },
  signatureImage: {
    width: 90,
    height: 30,
    objectFit: 'contain',
    objectPositionX: 0,
  },
  signatureMissing: {
    fontSize: fontSize.base,
    color: palette.slate400,
  },
  earlierNote: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 4,
  },
})

// Hazards columns — Task | Hazards | Risk | Controls | Residual
const hazardCol = StyleSheet.create({
  task: { width: '20%' },
  hazards: { width: '26%' },
  risk: { width: '8%' },
  controls: { width: '36%' },
  residual: { width: '10%' },
})

// Signatures columns — Name | Signed | Version | Signature
const sigCol = StyleSheet.create({
  name: { width: '34%' },
  date: { width: '18%' },
  version: { width: '12%' },
  signature: { width: '36%' },
})

function HazardsTable({ hazards }: { hazards: SwmsPdfHazard[] }) {
  if (hazards.length === 0) return null

  return (
    <View style={[tableStyles.table, styles.section]}>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>Hazards &amp; controls</Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, hazardCol.task]}>Task</Text>
        <Text style={[tableStyles.headCell, hazardCol.hazards]}>Hazards</Text>
        <Text style={[tableStyles.headCell, hazardCol.risk]}>Risk</Text>
        <Text style={[tableStyles.headCell, hazardCol.controls]}>Controls</Text>
        <Text style={[tableStyles.headCell, hazardCol.residual]}>Residual</Text>
      </View>
      {hazards.map((h, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, hazardCol.task]}>{h.task}</Text>
          <Text style={[tableStyles.cell, hazardCol.hazards]}>{h.hazards}</Text>
          <Text style={[tableStyles.cell, hazardCol.risk]}>{h.risk}</Text>
          <Text style={[tableStyles.cell, hazardCol.controls]}>{h.controls}</Text>
          <Text style={[tableStyles.cell, hazardCol.residual]}>
            {h.residual_risk}
          </Text>
        </View>
      ))}
    </View>
  )
}

function SignatureTable({
  signatures,
  earlierSignatureCount,
}: {
  signatures: SwmsPdfSignature[]
  earlierSignatureCount: number
}) {
  return (
    <View style={[tableStyles.table, styles.section]}>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>Sign-on register</Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, sigCol.name]}>Name</Text>
        <Text style={[tableStyles.headCell, sigCol.date]}>Signed</Text>
        <Text style={[tableStyles.headCell, sigCol.version]}>Version</Text>
        <Text style={[tableStyles.headCell, sigCol.signature]}>Signature</Text>
      </View>
      {signatures.length === 0 ? (
        <View style={tableStyles.row}>
          <Text style={tableStyles.cellMuted}>No signatures for this version yet.</Text>
        </View>
      ) : (
        signatures.map((s, i) => (
          <View key={i} style={tableStyles.row} wrap={false}>
            <Text style={[tableStyles.cell, sigCol.name]}>{s.name}</Text>
            <Text style={[tableStyles.cell, sigCol.date]}>{s.date}</Text>
            <Text style={[tableStyles.cell, sigCol.version]}>v{s.version}</Text>
            <View style={sigCol.signature}>
              {s.imageUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
                <Image src={s.imageUrl} style={styles.signatureImage} />
              ) : (
                <Text style={styles.signatureMissing}>—</Text>
              )}
            </View>
          </View>
        ))
      )}
      {earlierSignatureCount > 0 && (
        <Text style={styles.earlierNote}>
          {earlierSignatureCount}{' '}
          {earlierSignatureCount === 1 ? 'signature' : 'signatures'} for earlier
          versions not shown.
        </Text>
      )}
    </View>
  )
}

/**
 * Safe work method statement export: title block (project/job, version,
 * status), safe work method body, hazards table and the current-version
 * sign-on register with signature images.
 */
export function SwmsPdf({
  swms,
  company,
  body,
  hazards,
  signatures,
  earlierSignatureCount,
}: SwmsPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  const bodyParagraphs = (body ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <Document title={`SWMS — ${swms.title}`} author={company.name}>
      <Page size="A4" style={styles.page}>
        <View style={headerStyles.bar}>
          <View style={headerStyles.companyBlock}>
            {company.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
              <Image src={company.logoUrl} style={headerStyles.logo} />
            ) : null}
            <Text style={headerStyles.companyName}>{company.name}</Text>
            {companyLines.map((line, i) => (
              <Text key={i} style={headerStyles.companyLine}>
                {line}
              </Text>
            ))}
          </View>
          <View style={headerStyles.titleBlock}>
            <Text style={headerStyles.title}>SWMS</Text>
            <Text style={headerStyles.docNumber}>{swms.title}</Text>
            <Text style={headerStyles.docDate}>{swms.date}</Text>
          </View>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Project / job</Text>
            <Text style={styles.metaValue}>{swms.parentLabel}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Version</Text>
            <Text style={styles.metaValue}>v{swms.version}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.metaLabel}>Status</Text>
            <Text style={styles.metaValue}>
              {swms.status === 'superseded' ? 'Superseded' : 'Active'}
            </Text>
          </View>
        </View>

        {bodyParagraphs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Safe work method</Text>
            {bodyParagraphs.map((p, i) => (
              <Text key={i} style={[styles.bodyText, { marginBottom: 4 }]}>
                {p}
              </Text>
            ))}
          </View>
        )}

        <HazardsTable hazards={hazards} />
        <SignatureTable
          signatures={signatures}
          earlierSignatureCount={earlierSignatureCount}
        />

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            SWMS — {swms.title} (v{swms.version}) — {swms.parentLabel}
          </Text>
          <Text
            style={styles.pageNumber}
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
            fixed
          />
        </View>
      </Page>
    </Document>
  )
}
