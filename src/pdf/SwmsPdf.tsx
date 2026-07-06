import type { ReactNode } from 'react'
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { DocShell, type DocCompany } from './DocShell'
import { palette, fontSize, tableStyles } from './theme'

// ─── Props ───────────────────────────────────────────────────────────────────

export type SwmsPdfStep = {
  step: string
  hazards: string
  initial_risk: string
  controls: string
  residual_risk: string
  responsible: string
}

export type SwmsPdfRow = { label: string; value: string }

export type SwmsPdfScenario = {
  scenario: string
  immediate_action: string
  notification: string
}

export type SwmsPdfSignature = {
  name: string
  /** Profile role for internal signers, "External" for share-link signers. */
  role: string
  company: string
  /** Pre-formatted date, e.g. "12/06/2026". */
  date: string
  version: number
  /** Signed https URL or data URL of the PNG, or null when unavailable. */
  imageUrl: string | null
}

export type SwmsPdfChange = {
  /** Pre-formatted date. */
  date: string
  description: string
  by: string
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
  /** Document control rows (prepared by, approved by, project, …). */
  docControl: SwmsPdfRow[]
  scopeNote: string
  projectDetails: SwmsPdfRow[]
  /** HRCW checklist items with their confirmed answers ("Yes"/"No"/"N/A"). */
  hrcw: SwmsPdfRow[]
  requirements: SwmsPdfRow[]
  steps: SwmsPdfStep[]
  stopWorkTriggers: string[]
  emergencyContacts: SwmsPdfRow[]
  emergencyScenarios: SwmsPdfScenario[]
  referencesList: string[]
  /** Current-version signatures only. */
  signatures: SwmsPdfSignature[]
  /** Count of signatures pinned to earlier versions. */
  earlierSignatureCount: number
  /** Review / change record (issue + revisions), oldest first. */
  changes: SwmsPdfChange[]
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  scopeText: {
    fontSize: fontSize.base,
    color: palette.slate900,
    lineHeight: 1.5,
    marginBottom: 2,
  },
  noteText: {
    fontSize: fontSize.sm,
    color: palette.slate500,
    lineHeight: 1.5,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 5,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  bulletMark: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  bulletText: {
    flex: 1,
    fontSize: fontSize.base,
    color: palette.slate900,
    lineHeight: 1.4,
  },
  signatureImage: {
    width: 90,
    height: 26,
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
  matrixCell: {
    fontSize: fontSize.sm,
    color: palette.slate700,
    textAlign: 'center',
  },
  matrixLead: {
    fontSize: fontSize.sm,
    color: palette.slate700,
  },
})

// Column widths
const rowCol = StyleSheet.create({
  label: { width: '32%' },
  value: { width: '68%' },
})
const hrcwCol = StyleSheet.create({
  item: { width: '86%' },
  answer: { width: '14%' },
})
const stepCol = StyleSheet.create({
  step: { width: '16%' },
  hazards: { width: '20%' },
  initial: { width: '7%' },
  controls: { width: '34%' },
  residual: { width: '8%' },
  responsible: { width: '15%' },
})
const scenarioCol = StyleSheet.create({
  scenario: { width: '24%' },
  action: { width: '40%' },
  notification: { width: '36%' },
})
const sigCol = StyleSheet.create({
  name: { width: '24%' },
  role: { width: '12%' },
  company: { width: '18%' },
  date: { width: '14%' },
  signature: { width: '32%' },
})
const changeCol = StyleSheet.create({
  date: { width: '15%' },
  description: { width: '60%' },
  by: { width: '25%' },
})
const matrixCol = StyleSheet.create({
  lead: { width: '30%' },
  cell: { width: '14%' },
})

// ─── Building blocks ─────────────────────────────────────────────────────────

function SectionTable({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <View style={tableStyles.table}>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  )
}

function LabelValueRows({ rows }: { rows: SwmsPdfRow[] }) {
  return (
    <>
      {rows.map((r, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cellMuted, rowCol.label]}>{r.label}</Text>
          <Text style={[tableStyles.cell, rowCol.value]}>{r.value}</Text>
        </View>
      ))}
    </>
  )
}

function BulletList({ items }: { items: string[] }) {
  return (
    <>
      {items.map((item, i) => (
        <View key={i} style={styles.bulletRow} wrap={false}>
          <Text style={styles.bulletMark}>-</Text>
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </>
  )
}

// ─── Static risk matrix reference (H/M/L rating rules) ───────────────────────

const MATRIX_HEADERS = ['Common', 'Probable', 'Occasional', 'Rare', 'Practically never']
const MATRIX_ROWS: { consequence: string; scores: number[] }[] = [
  { consequence: 'Fatality', scores: [1, 2, 4, 7, 11] },
  { consequence: 'Permanent disability or disease', scores: [3, 5, 8, 12, 16] },
  { consequence: 'Lost time injury', scores: [6, 9, 13, 17, 20] },
  { consequence: 'Medical treatment injury', scores: [10, 14, 18, 21, 23] },
  { consequence: 'Minor injury or first aid', scores: [15, 19, 22, 24, 25] },
]
const MATRIX_BANDS: SwmsPdfRow[] = [
  {
    label: '1-6 — High (H)',
    value:
      'Do not start until controls are confirmed by the responsible director. Escalate if residual risk remains high.',
  },
  {
    label: '7-15 — Medium (M)',
    value:
      'Proceed only with the nominated controls, competent workers, supervision and active monitoring.',
  },
  {
    label: '16-25 — Low (L)',
    value: 'Proceed with routine controls and monitor for changed conditions.',
  },
]

function RiskMatrixReference() {
  return (
    <SectionTable title="Risk rating reference (H/M/L)">
      <View style={{ paddingHorizontal: 8, paddingTop: 6 }}>
        <Text style={styles.noteText}>
          Controls are selected using the hierarchy of controls: elimination
          first, then substitution, isolation, engineering and administrative
          controls. PPE is the last line of defence. Ratings in this SWMS are
          the practical H/M/L ratings below; the numeric matrix is reference
          only and is not the corporate risk register scale.
        </Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, matrixCol.lead]}>
          Consequence \ Likelihood
        </Text>
        {MATRIX_HEADERS.map((h) => (
          <Text key={h} style={[tableStyles.headCell, matrixCol.cell, { textAlign: 'center' }]}>
            {h}
          </Text>
        ))}
      </View>
      {MATRIX_ROWS.map((row, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[styles.matrixLead, matrixCol.lead]}>{row.consequence}</Text>
          {row.scores.map((s, j) => (
            <Text key={j} style={[styles.matrixCell, matrixCol.cell]}>
              {s}
            </Text>
          ))}
        </View>
      ))}
      <LabelValueRows rows={MATRIX_BANDS} />
    </SectionTable>
  )
}

// ─── Main sections ───────────────────────────────────────────────────────────

function StepsTable({ steps }: { steps: SwmsPdfStep[] }) {
  if (steps.length === 0) return null
  return (
    <SectionTable title="Work steps, hazards & controls">
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, stepCol.step]}>Work step</Text>
        <Text style={[tableStyles.headCell, stepCol.hazards]}>Key hazards</Text>
        <Text style={[tableStyles.headCell, stepCol.initial]}>Initial</Text>
        <Text style={[tableStyles.headCell, stepCol.controls]}>Required controls</Text>
        <Text style={[tableStyles.headCell, stepCol.residual]}>Residual</Text>
        <Text style={[tableStyles.headCell, stepCol.responsible]}>
          Responsible / evidence
        </Text>
      </View>
      {steps.map((s, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, stepCol.step]}>
            {i + 1}. {s.step}
          </Text>
          <Text style={[tableStyles.cell, stepCol.hazards]}>{s.hazards}</Text>
          <Text style={[tableStyles.cell, stepCol.initial]}>{s.initial_risk}</Text>
          <Text style={[tableStyles.cell, stepCol.controls]}>{s.controls}</Text>
          <Text style={[tableStyles.cell, stepCol.residual]}>{s.residual_risk}</Text>
          <Text style={[tableStyles.cell, stepCol.responsible]}>{s.responsible}</Text>
        </View>
      ))}
    </SectionTable>
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
    <SectionTable title="Worker sign-on register (digital)">
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, sigCol.name]}>Name</Text>
        <Text style={[tableStyles.headCell, sigCol.role]}>Role</Text>
        <Text style={[tableStyles.headCell, sigCol.company]}>Company</Text>
        <Text style={[tableStyles.headCell, sigCol.date]}>Signed</Text>
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
            <Text style={[tableStyles.cell, sigCol.role]}>{s.role}</Text>
            <Text style={[tableStyles.cell, sigCol.company]}>{s.company}</Text>
            <Text style={[tableStyles.cell, sigCol.date]}>{s.date}</Text>
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
        <View style={{ paddingHorizontal: 8 }}>
          <Text style={styles.earlierNote}>
            {earlierSignatureCount}{' '}
            {earlierSignatureCount === 1 ? 'signature' : 'signatures'} for earlier
            versions not shown. Workers re-sign after every revision.
          </Text>
        </View>
      )}
    </SectionTable>
  )
}

// ─── Document ────────────────────────────────────────────────────────────────

/**
 * Full-layout SWMS export following the professional SWMS anatomy:
 * document control, project-specific details, answered HRCW checklist,
 * minimum competency/PPE/equipment/monitoring, H/M/L rating reference,
 * work-step risk table, stop-work triggers, emergency response, references,
 * the digital sign-on register and the review/change record.
 */
export function SwmsPdf({
  swms,
  company,
  docControl,
  scopeNote,
  projectDetails,
  hrcw,
  requirements,
  steps,
  stopWorkTriggers,
  emergencyContacts,
  emergencyScenarios,
  referencesList,
  signatures,
  earlierSignatureCount,
  changes,
}: SwmsPdfProps) {
  return (
    <DocShell
      title="SWMS"
      docNumber={swms.title}
      docDate={swms.date}
      company={company}
      footerText={`SWMS — ${swms.title} (v${swms.version}) — ${swms.parentLabel}`}
    >
      {/* Document control */}
      <SectionTable title="Document control">
        <LabelValueRows
          rows={[
            { label: 'Project / job', value: swms.parentLabel },
            { label: 'Version', value: `v${swms.version}` },
            {
              label: 'Status',
              value: swms.status === 'superseded' ? 'Superseded' : 'Active',
            },
            ...docControl,
          ]}
        />
        {scopeNote !== '' && (
          <View style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
            <Text style={styles.scopeText}>{scopeNote}</Text>
          </View>
        )}
      </SectionTable>

      {/* Project-specific details */}
      {projectDetails.length > 0 && (
        <SectionTable title="Project-specific details">
          <LabelValueRows rows={projectDetails} />
        </SectionTable>
      )}

      {/* HRCW checklist */}
      {hrcw.length > 0 && (
        <SectionTable title="High-risk construction work checklist">
          <View style={tableStyles.headRow}>
            <Text style={[tableStyles.headCell, hrcwCol.item]}>Item</Text>
            <Text style={[tableStyles.headCell, hrcwCol.answer]}>Answer</Text>
          </View>
          {hrcw.map((r, i) => (
            <View key={i} style={tableStyles.row} wrap={false}>
              <Text style={[tableStyles.cell, hrcwCol.item]}>{r.label}</Text>
              <Text style={[tableStyles.cell, hrcwCol.answer]}>{r.value}</Text>
            </View>
          ))}
        </SectionTable>
      )}

      {/* Minimum requirements */}
      {requirements.length > 0 && (
        <SectionTable title="Minimum competency, PPE, equipment & monitoring">
          <LabelValueRows rows={requirements} />
        </SectionTable>
      )}

      {/* Hierarchy note + static H/M/L matrix reference */}
      <RiskMatrixReference />

      {/* Task step table */}
      <StepsTable steps={steps} />

      {/* Stop-work triggers */}
      {stopWorkTriggers.length > 0 && (
        <SectionTable title="Stop-work triggers">
          <View style={{ paddingVertical: 4 }}>
            <BulletList items={stopWorkTriggers} />
          </View>
        </SectionTable>
      )}

      {/* Emergency response */}
      {(emergencyContacts.length > 0 || emergencyScenarios.length > 0) && (
        <SectionTable title="Emergency response">
          <LabelValueRows
            rows={[
              {
                label: 'Emergency services',
                value: '000 (or 112 from a mobile phone)',
              },
              ...emergencyContacts,
            ]}
          />
          {emergencyScenarios.length > 0 && (
            <>
              <View style={tableStyles.headRow}>
                <Text style={[tableStyles.headCell, scenarioCol.scenario]}>Scenario</Text>
                <Text style={[tableStyles.headCell, scenarioCol.action]}>
                  Immediate action
                </Text>
                <Text style={[tableStyles.headCell, scenarioCol.notification]}>
                  Notification / follow-up
                </Text>
              </View>
              {emergencyScenarios.map((s, i) => (
                <View key={i} style={tableStyles.row} wrap={false}>
                  <Text style={[tableStyles.cell, scenarioCol.scenario]}>{s.scenario}</Text>
                  <Text style={[tableStyles.cell, scenarioCol.action]}>
                    {s.immediate_action}
                  </Text>
                  <Text style={[tableStyles.cell, scenarioCol.notification]}>
                    {s.notification}
                  </Text>
                </View>
              ))}
            </>
          )}
        </SectionTable>
      )}

      {/* References */}
      {referencesList.length > 0 && (
        <SectionTable title="References">
          <View style={{ paddingVertical: 4 }}>
            <BulletList items={referencesList} />
          </View>
        </SectionTable>
      )}

      {/* Digital sign-on register */}
      <SignatureTable
        signatures={signatures}
        earlierSignatureCount={earlierSignatureCount}
      />

      {/* Review / change record */}
      {changes.length > 0 && (
        <SectionTable title="Review & change record">
          <View style={tableStyles.headRow}>
            <Text style={[tableStyles.headCell, changeCol.date]}>Date</Text>
            <Text style={[tableStyles.headCell, changeCol.description]}>Change</Text>
            <Text style={[tableStyles.headCell, changeCol.by]}>By</Text>
          </View>
          {changes.map((c, i) => (
            <View key={i} style={tableStyles.row} wrap={false}>
              <Text style={[tableStyles.cell, changeCol.date]}>{c.date}</Text>
              <Text style={[tableStyles.cell, changeCol.description]}>{c.description}</Text>
              <Text style={[tableStyles.cell, changeCol.by]}>{c.by}</Text>
            </View>
          ))}
        </SectionTable>
      )}
    </DocShell>
  )
}
