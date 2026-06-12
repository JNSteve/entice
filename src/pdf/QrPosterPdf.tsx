import { Document, Page, View, Text, Image, StyleSheet } from '@react-pdf/renderer'
import type { DocCompany } from './DocShell'
import { palette, fontSize, font, headerStyles } from './theme'

export type QrPosterPdfProps = {
  company: DocCompany
  /** Share-link kind — drives the headline/title copy. */
  kind: 'signon' | 'subbie_swms'
  /** Share-link label, e.g. "Excavation SWMS — site sign-on". */
  label: string
  /** "P-0001 — Riverbank Stabilisation" or null. */
  projectName: string | null
  /** PNG data URL of the QR code (generated server-side via `qrcode`). */
  qrDataUrl: string
  /** The public sign-on/submission URL, printed under the QR for manual entry. */
  url: string
}

const POSTER_COPY: Record<
  QrPosterPdfProps['kind'],
  { headline: string; docTitle: string; cornerTitle: string }
> = {
  signon: {
    headline: 'Sign on here',
    docTitle: 'Sign-on poster',
    cornerTitle: 'Sign-on',
  },
  subbie_swms: {
    headline: 'Submit your SWMS here',
    docTitle: 'SWMS submission poster',
    cornerTitle: 'SWMS submission',
  },
}

const styles = StyleSheet.create({
  page: {
    fontFamily: font.regular,
    fontSize: fontSize.base,
    color: palette.slate900,
    paddingTop: 36,
    paddingHorizontal: 48,
    paddingBottom: 70,
    backgroundColor: palette.white,
  },
  body: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  headline: {
    fontFamily: font.bold,
    fontSize: 44,
    color: palette.navy,
    textTransform: 'uppercase',
    letterSpacing: 2,
    textAlign: 'center',
  },
  label: {
    fontFamily: font.bold,
    fontSize: 18,
    color: palette.slate900,
    textAlign: 'center',
  },
  projectName: {
    fontSize: 13,
    color: palette.slate500,
    textAlign: 'center',
  },
  qrFrame: {
    marginTop: 8,
    padding: 14,
    borderWidth: 2,
    borderColor: palette.navy,
    borderRadius: 8,
  },
  qr: {
    width: 330,
    height: 330,
  },
  url: {
    fontSize: 11,
    color: palette.slate700,
    textAlign: 'center',
    marginTop: 4,
  },
  footer: {
    position: 'absolute',
    left: 48,
    right: 48,
    bottom: 28,
    borderTopWidth: 0.5,
    borderTopColor: palette.slate300,
    paddingTop: 10,
  },
  footerText: {
    fontFamily: font.bold,
    fontSize: 13,
    color: palette.slate700,
    textAlign: 'center',
  },
})

/**
 * A4 portrait poster for site walls: company header, big "SIGN ON HERE"
 * (or "SUBMIT YOUR SWMS HERE") headline, the share-link label and project,
 * a large QR pointing at /sign/[token] (or /submit/[token]), and the URL
 * for phones that can't scan.
 */
export function QrPosterPdf({
  company,
  kind,
  label,
  projectName,
  qrDataUrl,
  url,
}: QrPosterPdfProps) {
  const copy = POSTER_COPY[kind]
  const companyLines = [
    company.abn ? `ABN ${company.abn}` : null,
    company.address,
    [company.phone, company.email].filter(Boolean).join('  ·  ') || null,
  ].filter((line): line is string => Boolean(line))

  return (
    <Document title={`${copy.docTitle} — ${label}`} author={company.name}>
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
            <Text style={headerStyles.title}>{copy.cornerTitle}</Text>
          </View>
        </View>

        <View style={styles.body}>
          <Text style={styles.headline}>{copy.headline}</Text>
          <View>
            <Text style={styles.label}>{label}</Text>
            {projectName ? (
              <Text style={styles.projectName}>{projectName}</Text>
            ) : null}
          </View>
          <View style={styles.qrFrame}>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            <Image src={qrDataUrl} style={styles.qr} />
          </View>
          <Text style={styles.url}>{url}</Text>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Scan with your phone camera — no app needed
          </Text>
        </View>
      </Page>
    </Document>
  )
}
