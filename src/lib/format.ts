import { format, isValid, parseISO } from 'date-fns'

const audFormatter = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
})

export function aud(n: number): string {
  const raw = audFormatter.format(n)
  // Normalise: strip 'A' prefix if present (e.g. 'A$1,234.50' → '$1,234.50')
  // Also normalise any narrow/non-breaking spaces to regular commas/spaces
  return raw.replace(/^A/, '').replace(/ /g, ',').replace(/ /g, ',')
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (d == null) return ''
  try {
    const date = d instanceof Date ? d : parseISO(d)
    if (!isValid(date)) return ''
    return format(date, 'dd/MM/yyyy')
  } catch {
    return ''
  }
}

export function pct(n: number): string {
  // parseFloat trims trailing zeros from numeric string
  return `${parseFloat(n.toFixed(10))}%`
}
