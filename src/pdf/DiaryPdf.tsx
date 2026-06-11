import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles, tableStyles } from './theme'

export type DiaryPdfLabour = {
  name: string
  trade: string | null
  headcount: number
  hours: number
}

export type DiaryPdfPlant = {
  name: string
  status: string
  hours: number
}

export type DiaryPdfPhoto = {
  /** Signed https URL — must be PNG/JPEG for react-pdf. */
  url: string
  caption: string | null
  /** Pre-formatted timestamp, e.g. "11/06/2026 14:32". */
  timestamp: string
}

export type DiaryPdfDay = {
  /** Pre-formatted display date, e.g. "Thursday 11/06/2026". */
  date: string
  weather: string | null
  author: string | null
  work_performed: string | null
  delays: string | null
  instructions: string | null
  visitors: string | null
  labour: DiaryPdfLabour[]
  plant: DiaryPdfPlant[]
  photos: DiaryPdfPhoto[]
}

export type DiaryPdfProps = {
  project: {
    name: string
    number: string
  }
  company: DocCompany
  /** One page per day, in date order. */
  days: DiaryPdfDay[]
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
    justifyContent: 'space-between',
    gap: 16,
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
    marginBottom: 10,
  },
  sectionLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  sectionText: {
    fontSize: fontSize.base,
    color: palette.slate900,
    lineHeight: 1.5,
  },
  sectionEmpty: {
    fontSize: fontSize.base,
    color: palette.slate400,
  },
  totalRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate50,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  totalCell: {
    fontFamily: font.bold,
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  photoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  photoCell: {
    width: '23.5%',
    flexDirection: 'column',
    gap: 2,
  },
  photoImage: {
    width: '100%',
    height: 90,
    objectFit: 'cover',
    borderRadius: 2,
    backgroundColor: palette.slate100,
  },
  photoCaption: {
    fontSize: fontSize.xs,
    color: palette.slate700,
  },
  photoTimestamp: {
    fontSize: fontSize.xs,
    color: palette.slate500,
  },
})

// Labour columns — Name | Trade | Headcount | Hours
const labourCol = StyleSheet.create({
  name: { width: '40%' },
  trade: { width: '28%' },
  headcount: { width: '16%' },
  hours: { width: '16%' },
})

// Plant columns — Name | Status | Hours
const plantCol = StyleSheet.create({
  name: { width: '56%' },
  status: { width: '28%' },
  hours: { width: '16%' },
})

function TextSection({ label, text }: { label: string; text: string | null }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {text ? (
        <Text style={styles.sectionText}>{text}</Text>
      ) : (
        <Text style={styles.sectionEmpty}>—</Text>
      )}
    </View>
  )
}

function LabourTable({ labour }: { labour: DiaryPdfLabour[] }) {
  if (labour.length === 0) return null

  const totalHeadcount = labour.reduce((s, l) => s + l.headcount, 0)
  const totalHours = labour.reduce((s, l) => s + l.headcount * l.hours, 0)

  return (
    <View style={[tableStyles.table, styles.section]}>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>Labour</Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, labourCol.name]}>Name</Text>
        <Text style={[tableStyles.headCell, labourCol.trade]}>Trade</Text>
        <Text style={[tableStyles.headCell, labourCol.headcount, tableStyles.right]}>
          Headcount
        </Text>
        <Text style={[tableStyles.headCell, labourCol.hours, tableStyles.right]}>
          Hours
        </Text>
      </View>
      {labour.map((l, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, labourCol.name]}>{l.name}</Text>
          <Text style={[tableStyles.cellMuted, labourCol.trade]}>{l.trade ?? '—'}</Text>
          <Text style={[tableStyles.cell, labourCol.headcount, tableStyles.right]}>
            {l.headcount}
          </Text>
          <Text style={[tableStyles.cell, labourCol.hours, tableStyles.right]}>
            {l.hours}
          </Text>
        </View>
      ))}
      <View style={styles.totalRow} wrap={false}>
        <Text style={[styles.totalCell, labourCol.name]}>Total</Text>
        <Text style={[styles.totalCell, labourCol.trade]} />
        <Text style={[styles.totalCell, labourCol.headcount, tableStyles.right]}>
          {totalHeadcount}
        </Text>
        <Text style={[styles.totalCell, labourCol.hours, tableStyles.right]}>
          {totalHours}
        </Text>
      </View>
    </View>
  )
}

function PlantTable({ plant }: { plant: DiaryPdfPlant[] }) {
  if (plant.length === 0) return null

  return (
    <View style={[tableStyles.table, styles.section]}>
      <View style={tableStyles.sectionTitleRow}>
        <Text style={tableStyles.sectionTitle}>Plant</Text>
      </View>
      <View style={tableStyles.headRow}>
        <Text style={[tableStyles.headCell, plantCol.name]}>Name</Text>
        <Text style={[tableStyles.headCell, plantCol.status]}>Status</Text>
        <Text style={[tableStyles.headCell, plantCol.hours, tableStyles.right]}>
          Hours
        </Text>
      </View>
      {plant.map((p, i) => (
        <View key={i} style={tableStyles.row} wrap={false}>
          <Text style={[tableStyles.cell, plantCol.name]}>{p.name}</Text>
          <Text style={[tableStyles.cellMuted, plantCol.status]}>{p.status}</Text>
          <Text style={[tableStyles.cell, plantCol.hours, tableStyles.right]}>
            {p.hours}
          </Text>
        </View>
      ))}
    </View>
  )
}

function PhotoSheet({ photos }: { photos: DiaryPdfPhoto[] }) {
  if (photos.length === 0) return null

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Photos</Text>
      <View style={styles.photoGrid}>
        {photos.map((photo, i) => (
          <View key={i} style={styles.photoCell} wrap={false}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            <Image src={photo.url} style={styles.photoImage} />
            {photo.caption ? (
              <Text style={styles.photoCaption}>{photo.caption}</Text>
            ) : null}
            <Text style={styles.photoTimestamp}>{photo.timestamp}</Text>
          </View>
        ))}
      </View>
    </View>
  )
}

/**
 * Site diary export: one A4 page per day (overflowing content wraps onto
 * continuation pages), shared branded header, labour/plant tables and a 4-up
 * photo contact sheet. Multi-day ranges render in date order.
 */
export function DiaryPdf({ project, company, days }: DiaryPdfProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title={`Site Diary — ${project.number}`} author={company.name}>
      {days.map((day, i) => (
        <Page key={i} size="A4" style={styles.page}>
          <View style={headerStyles.bar}>
            <View style={headerStyles.companyBlock}>
              {company.logoUrl ? (
                // eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop
                <Image src={company.logoUrl} style={headerStyles.logo} />
              ) : null}
              <Text style={headerStyles.companyName}>{company.name}</Text>
              {companyLines.map((line, j) => (
                <Text key={j} style={headerStyles.companyLine}>
                  {line}
                </Text>
              ))}
            </View>
            <View style={headerStyles.titleBlock}>
              <Text style={headerStyles.title}>Site Diary</Text>
              <Text style={headerStyles.docNumber}>
                {project.number} — {project.name}
              </Text>
              <Text style={headerStyles.docDate}>{day.date}</Text>
            </View>
          </View>

          <View style={styles.metaRow}>
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Weather</Text>
              <Text style={styles.metaValue}>{day.weather ?? '—'}</Text>
            </View>
            <View style={styles.metaBlock}>
              <Text style={styles.metaLabel}>Recorded by</Text>
              <Text style={styles.metaValue}>{day.author ?? '—'}</Text>
            </View>
          </View>

          <TextSection label="Work performed" text={day.work_performed} />
          <TextSection label="Delays" text={day.delays} />
          <TextSection label="Instructions received" text={day.instructions} />
          <TextSection label="Visitors" text={day.visitors} />

          <LabourTable labour={day.labour} />
          <PlantTable plant={day.plant} />
          <PhotoSheet photos={day.photos} />

          <View style={styles.footer} fixed>
            <Text style={styles.footerText}>
              Site diary — {project.number} {project.name}
            </Text>
            <Text
              style={styles.pageNumber}
              render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
              fixed
            />
          </View>
        </Page>
      ))}
    </Document>
  )
}
