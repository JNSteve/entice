import { Text, View, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import {
  ChangeRecordTable,
  LabelValueRows,
  SectionTable,
  SignatureTable,
  type SwmsPdfChange,
  type SwmsPdfSignature,
} from './SwmsPdf'
import { palette, fontSize } from './theme'

export type SwmsRegisterPdfProps = {
  swms: { title: string; parentLabel: string; version: number; status: string; date: string }
  company: DocCompany
  sourceFilename: string
  /** Pre-formatted generation date/time. */
  generatedAt: string
  signatures: SwmsPdfSignature[]
  earlierSignatureCount: number
  changes: SwmsPdfChange[]
  /** Set when the original PDF could not be attached, e.g. "the PDF is password-protected". */
  originalProblem: string | null
}

const styles = StyleSheet.create({
  problem: {
    fontSize: fontSize.base,
    color: palette.slate900,
    borderWidth: 1,
    borderColor: palette.slate400,
    padding: 8,
    marginBottom: 10,
  },
})

/**
 * Sign-on register appended to an uploaded SWMS PDF (the "signed copy").
 * Rendered alone when the original can't be attached.
 */
export function SwmsRegisterPdf({
  swms,
  company,
  sourceFilename,
  generatedAt,
  signatures,
  earlierSignatureCount,
  changes,
  originalProblem,
}: SwmsRegisterPdfProps) {
  return (
    <DocShell
      title="SWMS sign-on register"
      docNumber={swms.title}
      docDate={swms.date}
      company={company}
      footerText={`SWMS — ${swms.title} (v${swms.version}) — ${swms.parentLabel}`}
    >
      {originalProblem && (
        <View>
          <Text style={styles.problem}>
            Original PDF could not be attached ({originalProblem}) — download it
            separately from Documents.
          </Text>
        </View>
      )}
      <SectionTable title="SWMS">
        <LabelValueRows
          rows={[
            { label: 'Title', value: swms.title },
            { label: 'Job / project', value: swms.parentLabel },
            { label: 'Version', value: `v${swms.version} (${swms.status})` },
            { label: 'Source file', value: sourceFilename },
            { label: 'Register generated', value: generatedAt },
          ]}
        />
      </SectionTable>
      <SignatureTable signatures={signatures} earlierSignatureCount={earlierSignatureCount} />
      <ChangeRecordTable changes={changes} />
    </DocShell>
  )
}
