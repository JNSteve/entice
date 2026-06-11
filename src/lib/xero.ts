/**
 * Xero Sales CSV export.
 *
 * Produces a Xero-compatible "Sales" CSV with one row per invoice line.
 * Spec: https://central.xero.com/s/article/Import-or-create-invoices-using-a-CSV-file
 */

export interface XeroInvoiceLine {
  description: string
  qty: number
  unitAmount: number
}

export interface XeroInvoice {
  number: string
  contactName: string
  /** ISO date string, e.g. "2026-06-01" */
  invoiceDate: string
  /** ISO date string, e.g. "2026-06-30" */
  dueDate: string
  reference?: string
  lines: XeroInvoiceLine[]
}

const HEADER =
  '*ContactName,EmailAddress,POAddressLine1,*InvoiceNumber,*InvoiceDate,*DueDate,*Description,*Quantity,*UnitAmount,*AccountCode,*TaxType,Reference'

const ACCOUNT_CODE = '200'
const TAX_TYPE = 'GST on Income'

/**
 * Escape a CSV field: wrap in double quotes if it contains comma, double-quote, or newline;
 * double any internal double-quotes.
 */
export function csvField(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return '"' + value.replace(/"/g, '""') + '"'
  }
  return value
}

/**
 * Convert an ISO date string (YYYY-MM-DD) to dd/MM/yyyy for Xero.
 */
function toXeroDate(iso: string): string {
  // Expects "YYYY-MM-DD"
  const [yyyy, mm, dd] = iso.split('-')
  return `${dd}/${mm}/${yyyy}`
}

/**
 * Build a Xero Sales CSV string from an array of invoices.
 * Returns just the header row when invoices is empty.
 * Uses LF line endings.
 */
export function xeroSalesCsv(invoices: XeroInvoice[]): string {
  const rows: string[] = [HEADER]

  for (const inv of invoices) {
    const contactName = csvField(inv.contactName)
    // InvoiceNumber is always quoted per Xero requirements
    const invoiceNumber = '"' + inv.number.replace(/"/g, '""') + '"'
    const invoiceDate = toXeroDate(inv.invoiceDate)
    const dueDate = toXeroDate(inv.dueDate)
    const reference = inv.reference ?? ''

    for (const line of inv.lines) {
      const description = csvField(line.description)
      const qty = String(line.qty)
      const unitAmount = String(line.unitAmount)

      rows.push(
        [
          contactName,   // *ContactName
          '',            // EmailAddress
          '',            // POAddressLine1
          invoiceNumber, // *InvoiceNumber
          invoiceDate,   // *InvoiceDate
          dueDate,       // *DueDate
          description,   // *Description
          qty,           // *Quantity
          unitAmount,    // *UnitAmount
          ACCOUNT_CODE,  // *AccountCode
          TAX_TYPE,      // *TaxType
          reference,     // Reference
        ].join(',')
      )
    }
  }

  return rows.join('\n')
}
