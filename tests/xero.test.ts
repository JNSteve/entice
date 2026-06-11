import { describe, expect, test } from 'vitest'
import { xeroSalesCsv, type XeroInvoice } from '../src/lib/xero'

const HEADER =
  '*ContactName,EmailAddress,POAddressLine1,*InvoiceNumber,*InvoiceDate,*DueDate,*Description,*Quantity,*UnitAmount,*AccountCode,*TaxType,Reference'

describe('xeroSalesCsv', () => {
  test('produces correct header', () => {
    const csv = xeroSalesCsv([])
    expect(csv).toBe(HEADER)
  })

  test('single invoice with one line', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0001',
        contactName: 'Acme Corp',
        invoiceDate: '2026-06-01',
        dueDate: '2026-06-30',
        reference: 'JOB-001',
        lines: [
          { description: 'Labour', qty: 2, unitAmount: 150 },
        ],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(HEADER)
    expect(lines[1]).toBe(
      'Acme Corp,,,"INV-0001",01/06/2026,30/06/2026,Labour,2,150,200,GST on Income,JOB-001'
    )
  })

  test('two-line invoice produces two data rows', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0002',
        contactName: 'Builder Co',
        invoiceDate: '2026-05-15',
        dueDate: '2026-06-15',
        reference: 'JOB-002',
        lines: [
          { description: 'Materials', qty: 10, unitAmount: 25.5 },
          { description: 'Delivery', qty: 1, unitAmount: 80 },
        ],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe(
      'Builder Co,,,"INV-0002",15/05/2026,15/06/2026,Materials,10,25.5,200,GST on Income,JOB-002'
    )
    expect(lines[2]).toBe(
      'Builder Co,,,"INV-0002",15/05/2026,15/06/2026,Delivery,1,80,200,GST on Income,JOB-002'
    )
  })

  test('description containing comma is quoted', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0003',
        contactName: 'Test Client',
        invoiceDate: '2026-01-01',
        dueDate: '2026-01-31',
        lines: [
          { description: 'Supply, install and test', qty: 1, unitAmount: 500 },
        ],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines[1]).toBe(
      'Test Client,,,"INV-0003",01/01/2026,31/01/2026,"Supply, install and test",1,500,200,GST on Income,'
    )
  })

  test('description containing double-quote escapes it', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0004',
        contactName: 'Quote Client',
        invoiceDate: '2026-02-01',
        dueDate: '2026-02-28',
        lines: [
          { description: '6" pipe installation', qty: 3, unitAmount: 75.25 },
        ],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines[1]).toBe(
      'Quote Client,,,"INV-0004",01/02/2026,28/02/2026,"6"" pipe installation",3,75.25,200,GST on Income,'
    )
  })

  test('two invoices: one two-line with comma+quote in description, one single-line', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0010',
        contactName: 'Smith & Sons',
        invoiceDate: '2026-03-01',
        dueDate: '2026-03-31',
        reference: 'JOB-010',
        lines: [
          { description: 'Supply "premium", grade timber', qty: 5, unitAmount: 200 },
          { description: 'Labour', qty: 8, unitAmount: 95 },
        ],
      },
      {
        number: 'INV-0011',
        contactName: 'Jones Pty Ltd',
        invoiceDate: '2026-03-15',
        dueDate: '2026-04-14',
        lines: [
          { description: 'Consulting', qty: 1, unitAmount: 1200 },
        ],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe(HEADER)
    // Description has both comma and double-quote — must be quoted with doubled internal quotes
    expect(lines[1]).toBe(
      'Smith & Sons,,,"INV-0010",01/03/2026,31/03/2026,"Supply ""premium"", grade timber",5,200,200,GST on Income,JOB-010'
    )
    expect(lines[2]).toBe(
      'Smith & Sons,,,"INV-0010",01/03/2026,31/03/2026,Labour,8,95,200,GST on Income,JOB-010'
    )
    expect(lines[3]).toBe(
      'Jones Pty Ltd,,,"INV-0011",15/03/2026,14/04/2026,Consulting,1,1200,200,GST on Income,'
    )
  })

  test('missing reference produces empty Reference column', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0005',
        contactName: 'No Ref Client',
        invoiceDate: '2026-04-01',
        dueDate: '2026-04-30',
        lines: [{ description: 'Service', qty: 1, unitAmount: 300 }],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines[1].endsWith(',GST on Income,')).toBe(true)
  })

  test('unitAmount with decimal places is preserved as-is', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0006',
        contactName: 'Precision Client',
        invoiceDate: '2026-05-01',
        dueDate: '2026-05-31',
        lines: [{ description: 'Widget', qty: 3, unitAmount: 33.33 }],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    const lines = csv.split('\n')
    expect(lines[1]).toContain(',3,33.33,')
  })

  test('InvoiceNumber field is always quoted', () => {
    const invoices: XeroInvoice[] = [
      {
        number: 'INV-0001',
        contactName: 'Test',
        invoiceDate: '2026-01-01',
        dueDate: '2026-01-31',
        lines: [{ description: 'Work', qty: 1, unitAmount: 100 }],
      },
    ]
    const csv = xeroSalesCsv(invoices)
    // InvoiceNumber should be in quotes per Xero requirements
    expect(csv).toContain('"INV-0001"')
  })
})
