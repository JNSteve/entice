import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles, tableStyles } from './theme'
import type { FormField, FormTemplateKind } from '@/lib/zod'

// ─── Types ────────────────────────────────────────────────────────────────────

export type FormPdfSignon = {
  name: string
  company: string | null
  /** true = app user; false = external pass-the-phone signon */
  internal: boolean
  signedAt: string
  /** Signed URL for a stored signature image, or a data URL. */
  imageUrl: string | null
}

export type FormPdfProps = {
  submission: {
    templateName: string
    kind: FormTemplateKind
    templateVersion: number
    submittedAt: string
    submittedBy: string
    target: string | null
    plant: string | null
    attachmentCount: number
  }
  company: DocCompany
  schema: FormField[]
  data: Record<string, unknown>
  signons: FormPdfSignon[]
}

// ─── Kind labels ──────────────────────────────────────────────────────────────

const KIND_LABELS: Record<FormTemplateKind, string> = {
  prestart: 'Pre-Start',
  take5: 'Take 5',
  toolbox: 'Toolbox Talk',
  induction: 'Site Induction',
  incident: 'Incident Report',
  custom: 'Custom Form',
  audit: 'Audit Checklist',
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  kindLabel: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    fontFamily: font.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'right',
  },
  metaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 0,
    marginBottom: 14,
    borderWidth: 0.5,
    borderColor: palette.slate200,
    borderRadius: 3,
  },
  metaCell: {
    width: '50%',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  metaLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  metaValue: {
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  fieldBlock: {
    marginBottom: 8,
  },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  fieldEmpty: {
    fontSize: fontSize.base,
    color: palette.slate400,
  },
  sigImage: {
    height: 40,
    width: 100,
    objectFit: 'contain',
    backgroundColor: palette.white,
    borderRadius: 2,
  },
  sectionHeader: {
    backgroundColor: palette.navy,
    paddingVertical: 5,
    paddingHorizontal: 8,
    marginBottom: 0,
  },
  sectionHeaderText: {
    fontFamily: font.bold,
    fontSize: fontSize.base,
    color: palette.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  otherFieldsBox: {
    borderWidth: 0.5,
    borderColor: palette.slate300,
    borderStyle: 'dashed',
    borderRadius: 3,
    padding: 8,
    marginTop: 4,
    marginBottom: 8,
  },
  otherFieldsTitle: {
    fontSize: fontSize.xs,
    fontFamily: font.bold,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  noteText: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    marginTop: 8,
  },
})

// Signon columns
const sigCol = StyleSheet.create({
  name: { width: '25%' },
  company: { width: '20%' },
  type: { width: '12%' },
  time: { width: '20%' },
  sig: { width: '23%' },
})

// ─── Field value renderer ─────────────────────────────────────────────────────

function renderFieldValue(field: FormField, value: unknown): React.ReactNode {
  switch (field.type) {
    case 'checkbox':
      return (
        <Text style={styles.fieldValue}>
          {value ? '✓ Yes' : '✗ No'}
        </Text>
      )
    case 'rating': {
      const n = Math.max(0, Math.min(5, Number(value) || 0))
      return (
        <Text style={styles.fieldValue}>
          {'★'.repeat(n)}{'☆'.repeat(5 - n)} ({n}/5)
        </Text>
      )
    }
    case 'signature':
      if (typeof value === 'string' && value.startsWith('data:image/')) {
        return (
          // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
          <Image src={value} style={styles.sigImage} />
        )
      }
      return <Text style={styles.fieldEmpty}>{value ? 'Signed' : '—'}</Text>
    case 'photo': {
      // Photo fields: just note the count; actual files are attachments
      return <Text style={styles.fieldEmpty}>(see attachments)</Text>
    }
    default: {
      const text = value != null && value !== '' ? String(value) : null
      return text ? (
        <Text style={styles.fieldValue}>{text}</Text>
      ) : (
        <Text style={styles.fieldEmpty}>—</Text>
      )
    }
  }
}

// ─── Signon table ─────────────────────────────────────────────────────────────

function SignonTable({ signons }: { signons: FormPdfSignon[] }) {
  if (signons.length === 0) return null

  return (
    <View style={[tableStyles.table, { marginTop: 14 }]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionHeaderText}>Sign-ons ({signons.length})</Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, sigCol.name]}>Name</Text>
        <Text style={[tableStyles.headCell, sigCol.company]}>Company</Text>
        <Text style={[tableStyles.headCell, sigCol.type]}>Type</Text>
        <Text style={[tableStyles.headCell, sigCol.time]}>Signed</Text>
        <Text style={[tableStyles.headCell, sigCol.sig]}>Signature</Text>
      </View>
      {signons.map((sg, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, sigCol.name]}>{sg.name}</Text>
          <Text style={[tableStyles.cellMuted, sigCol.company]}>{sg.company ?? '—'}</Text>
          <Text style={[tableStyles.cellMuted, sigCol.type]}>{sg.internal ? 'Internal' : 'External'}</Text>
          <Text style={[tableStyles.cellMuted, sigCol.time]}>{sg.signedAt}</Text>
          <View style={sigCol.sig}>
            {sg.imageUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
              <Image src={sg.imageUrl} style={{ height: 32, width: 80, objectFit: 'contain', backgroundColor: palette.white }} />
            ) : (
              <Text style={tableStyles.cellMuted}>—</Text>
            )}
          </View>
        </View>
      ))}
    </View>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FormPdf({ submission, company, schema, data, signons }: FormPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  // Schema drift: keys in data not in current schema
  const schemaKeys = new Set(schema.map((f) => f.key))
  const extraKeys = Object.keys(data).filter((k) => !schemaKeys.has(k))

  return (
    <Document title={`${submission.templateName} — ${submission.submittedAt.slice(0, 10)}`} author={company.name}>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={headerStyles.bar}>
          <View style={headerStyles.companyBlock}>
            {company.logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
              <Image src={company.logoUrl} style={headerStyles.logo} />
            ) : null}
            <Text style={headerStyles.companyName}>{company.name}</Text>
            {companyLines.map((line, i) => (
              <Text key={i} style={headerStyles.companyLine}>{line}</Text>
            ))}
          </View>
          <View style={headerStyles.titleBlock}>
            <Text style={headerStyles.title}>{submission.templateName}</Text>
            <Text style={styles.kindLabel}>{KIND_LABELS[submission.kind]}</Text>
            <Text style={headerStyles.docDate}>{submission.submittedAt.slice(0, 10).split('-').reverse().join('/')}</Text>
          </View>
        </View>

        {/* Meta block */}
        <View style={styles.metaGrid}>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Submitted by</Text>
            <Text style={styles.metaValue}>{submission.submittedBy}</Text>
          </View>
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Date &amp; time</Text>
            <Text style={styles.metaValue}>
              {submission.submittedAt.slice(0, 16).replace('T', ' ').split('-').join('/').replace(
                /^(\d{4})\/(\d{2})\/(\d{2})/,
                (_m, y, mo, d) => `${d}/${mo}/${y}`
              )}
            </Text>
          </View>
          {submission.target && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Project / Job</Text>
              <Text style={styles.metaValue}>{submission.target}</Text>
            </View>
          )}
          {submission.plant && (
            <View style={styles.metaCell}>
              <Text style={styles.metaLabel}>Plant</Text>
              <Text style={styles.metaValue}>{submission.plant}</Text>
            </View>
          )}
          <View style={styles.metaCell}>
            <Text style={styles.metaLabel}>Template version</Text>
            <Text style={styles.metaValue}>v{submission.templateVersion}</Text>
          </View>
        </View>

        {/* Form fields in schema order */}
        {schema.map((field) => (
          <View key={field.key} style={styles.fieldBlock} wrap={false}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            {renderFieldValue(field, data[field.key])}
          </View>
        ))}

        {/* Extra fields (schema drift) */}
        {extraKeys.length > 0 && (
          <View style={styles.otherFieldsBox}>
            <Text style={styles.otherFieldsTitle}>Other recorded fields</Text>
            {extraKeys.map((key) => (
              <View key={key} style={styles.fieldBlock} wrap={false}>
                <Text style={styles.fieldLabel}>{key}</Text>
                <Text style={styles.fieldValue}>
                  {data[key] != null && data[key] !== '' ? String(data[key]) : '—'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Sign-on table */}
        <SignonTable signons={signons} />

        {/* Attachment count footer note */}
        {submission.attachmentCount > 0 && (
          <Text style={styles.noteText}>
            Attachments: {submission.attachmentCount} file{submission.attachmentCount !== 1 ? 's' : ''} attached to this submission (not included in this PDF).
          </Text>
        )}

        {/* Page footer */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {submission.templateName} — {KIND_LABELS[submission.kind]}
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
