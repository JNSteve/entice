/**
 * Generic CSV helpers.
 *
 * `toCsv` turns an array of plain objects into a CSV string with a header row
 * built from the object keys. Field escaping follows the same approach as
 * src/lib/xero.ts: wrap in double quotes when the value contains a comma,
 * double-quote, or newline; double any internal double-quotes.
 */

export type CsvValue = string | number | boolean | null | undefined
export type CsvRow = Record<string, CsvValue>

/** Escape a single CSV field. null/undefined become the empty string. */
export function csvField(value: CsvValue): string {
  if (value == null) return ''
  const s = String(value)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

/**
 * Array of objects → CSV string with a header row (LF line endings).
 * The header is the union of keys across all rows, in order of first
 * appearance. Returns '' for an empty array.
 */
export function toCsv(rows: CsvRow[]): string {
  if (rows.length === 0) return ''

  const keys: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }

  const lines = [keys.map(csvField).join(',')]
  for (const row of rows) {
    lines.push(keys.map((key) => csvField(row[key])).join(','))
  }
  return lines.join('\n')
}

/**
 * Client-side utility: build a CSV from rows and trigger a browser download.
 * No-op when rows is empty.
 */
export function downloadCsv(filename: string, rows: CsvRow[]): void {
  if (rows.length === 0) return
  const csv = toCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
