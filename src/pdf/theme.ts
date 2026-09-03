import { Font, StyleSheet } from '@react-pdf/renderer'

// react-pdf hyphenates at line ends by default ("re-sponses"). Wrap on whole
// words in every document instead. The callback is global to the renderer.
Font.registerHyphenationCallback((word) => [word])

/**
 * Shared look-and-feel for every generated PDF (quotes, invoices, claims, …).
 * Clean construction-industry styling: navy headline colour, slate greys,
 * tight tables with a navy header band.
 */

export const palette = {
  navy: '#162040',
  navyLight: '#223056',
  slate900: '#1c2434',
  slate700: '#3e4a5e',
  slate500: '#64748b',
  slate400: '#8b97a8',
  slate300: '#c3ccd9',
  slate200: '#dfe5ed',
  slate100: '#eef1f6',
  slate50: '#f7f9fc',
  white: '#ffffff',
} as const

export const fontSize = {
  xs: 7,
  sm: 8,
  base: 9,
  md: 10,
  lg: 12,
  xl: 15,
  title: 22,
} as const

/** Standard Helvetica variants (built into every PDF reader). */
export const font = {
  regular: 'Helvetica',
  bold: 'Helvetica-Bold',
  oblique: 'Helvetica-Oblique',
} as const

/** Header bar: company block left, document title/number/date right. */
export const headerStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    borderBottomWidth: 2,
    borderBottomColor: palette.navy,
    paddingBottom: 14,
    marginBottom: 18,
  },
  companyBlock: {
    flexDirection: 'column',
    gap: 2,
    maxWidth: '55%',
  },
  logo: {
    maxHeight: 42,
    maxWidth: 160,
    objectFit: 'contain',
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  companyName: {
    fontFamily: font.bold,
    fontSize: fontSize.lg,
    color: palette.navy,
  },
  companyLine: {
    fontSize: fontSize.sm,
    color: palette.slate500,
  },
  titleBlock: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  title: {
    fontFamily: font.bold,
    fontSize: fontSize.title,
    color: palette.navy,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  docNumber: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.slate700,
  },
  docDate: {
    fontSize: fontSize.sm,
    color: palette.slate500,
  },
})

/** Line-item tables: navy header band, hairline row separators. */
export const tableStyles = StyleSheet.create({
  table: {
    marginBottom: 14,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    backgroundColor: palette.navy,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  sectionTitle: {
    fontFamily: font.bold,
    fontSize: fontSize.base,
    color: palette.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  headRow: {
    flexDirection: 'row',
    backgroundColor: palette.slate100,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  headCell: {
    fontFamily: font.bold,
    fontSize: fontSize.sm,
    color: palette.slate700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  row: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  cell: {
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  cellMuted: {
    fontSize: fontSize.base,
    color: palette.slate500,
  },
  right: {
    textAlign: 'right',
  },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: palette.slate50,
    borderBottomWidth: 1,
    borderBottomColor: palette.slate300,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 12,
  },
  subtotalLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  subtotalValue: {
    fontFamily: font.bold,
    fontSize: fontSize.base,
    color: palette.slate900,
  },
})

/** Right-aligned document totals block. */
export const totalsStyles = StyleSheet.create({
  block: {
    alignSelf: 'flex-end',
    width: 240,
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: palette.slate300,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: palette.slate200,
  },
  label: {
    fontSize: fontSize.base,
    color: palette.slate700,
  },
  value: {
    fontSize: fontSize.base,
    color: palette.slate900,
  },
  grandRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: palette.navy,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  grandLabel: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.white,
  },
  grandValue: {
    fontFamily: font.bold,
    fontSize: fontSize.md,
    color: palette.white,
  },
})
