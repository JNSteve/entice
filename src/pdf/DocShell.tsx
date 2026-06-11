import type { ReactNode } from 'react'
import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import { palette, fontSize, font, headerStyles } from './theme'

export type DocCompany = {
  name: string
  abn?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  logoUrl?: string | null
}

export type DocShellProps = {
  /** Document type headline, e.g. "Quotation". */
  title: string
  /** e.g. "Q-0001". */
  docNumber: string
  /** Pre-formatted display date, e.g. "11/06/2026". */
  docDate: string
  company: DocCompany
  /** Optional footer copy (terms line, payment details, …). */
  footerText?: string | null
  children: ReactNode
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
})

/**
 * Reusable A4 shell for every money/site document: branded header bar,
 * fixed footer with optional terms text and "Page N of M".
 */
export function DocShell({
  title,
  docNumber,
  docDate,
  company,
  footerText,
  children,
}: DocShellProps) {
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title={`${title} ${docNumber}`} author={company.name}>
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
            <Text style={headerStyles.title}>{title}</Text>
            <Text style={headerStyles.docNumber}>{docNumber}</Text>
            <Text style={headerStyles.docDate}>{docDate}</Text>
          </View>
        </View>

        {children}

        <View style={styles.footer} fixed>
          {footerText ? <Text style={styles.footerText}>{footerText}</Text> : <View style={{ flex: 1 }} />}
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
