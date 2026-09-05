import { describe, expect, test } from 'vitest'
import {
  buildClaimPayload,
  buildInvoicePayload,
  claimInvoiceNumber,
  deriveInvoiceStatusFromXero,
  ifModifiedSinceHeader,
  matchContactToClient,
  normaliseAbn,
  parseXeroDate,
  parseXeroInstant,
  totalsDiffer,
  workNumberFromReference,
  xeroErrorMessage,
  xeroLinesToInvoiceLines,
} from '../src/lib/xero/map'
import type { XeroMapping } from '../src/lib/xero/types'

const mapping: XeroMapping = {
  emailMode: 'xero',
  defaultAccount: '200',
  accountByKind: { labour: '210', subbie: '220' },
  claimsAccount: '230',
  gstTaxType: 'OUTPUT',
  noGstTaxType: 'EXEMPTOUTPUT',
  trackingCategoryId: 'cat-1',
}

describe('dates', () => {
  test('parseXeroDate accepts DateString, ISO and /Date()/ forms', () => {
    expect(parseXeroDate('2026-09-05T00:00:00')).toBe('2026-09-05')
    expect(parseXeroDate('2026-09-05')).toBe('2026-09-05')
    // 1757030400000 ms = 2025-09-05T00:00:00Z
    expect(parseXeroDate('/Date(1757030400000+0000)/')).toBe('2025-09-05')
    expect(parseXeroDate(undefined)).toBeNull()
    expect(parseXeroDate('garbage')).toBeNull()
  })

  test('parseXeroInstant returns an ISO timestamp', () => {
    expect(parseXeroInstant('/Date(1757030400000+0000)/')).toBe('2025-09-05T00:00:00.000Z')
    expect(parseXeroInstant('2026-09-05T01:02:03.000Z')).toBe('2026-09-05T01:02:03.000Z')
    expect(parseXeroInstant(undefined)).toBeNull()
  })

  test('ifModifiedSinceHeader is UTC seconds precision without the Z', () => {
    expect(ifModifiedSinceHeader('2026-09-05T01:02:03.456Z')).toBe('2026-09-05T01:02:03')
  })
})

describe('contacts', () => {
  test('normaliseAbn keeps digits only, null when empty or not 11 digits', () => {
    expect(normaliseAbn('51 824 753 556')).toBe('51824753556')
    expect(normaliseAbn('ABN 51824753556')).toBe('51824753556')
    expect(normaliseAbn('')).toBeNull()
    expect(normaliseAbn(null)).toBeNull()
    expect(normaliseAbn('123')).toBeNull()
  })

  test('matchContactToClient prefers ABN, then exact case-insensitive name, else null', () => {
    const clients = [
      { id: 'a', name: 'Mermaid Beach Bowls Club', abn: '51 824 753 556' },
      { id: 'b', name: 'Damon Constructions', abn: null },
      { id: 'c', name: 'Damon Constructions Pty Ltd', abn: null },
    ]
    expect(
      matchContactToClient({ ContactID: 'x', Name: 'MBBC', TaxNumber: '51824753556' }, clients)
    ).toBe('a')
    expect(
      matchContactToClient({ ContactID: 'x', Name: '  damon constructions ' }, clients)
    ).toBe('b')
    expect(matchContactToClient({ ContactID: 'x', Name: 'Nobody' }, clients)).toBeNull()
    // Duplicate names are ambiguous → null (never guess).
    expect(
      matchContactToClient({ ContactID: 'x', Name: 'Dup' }, [
        { id: 'd1', name: 'Dup', abn: null },
        { id: 'd2', name: 'dup', abn: null },
      ])
    ).toBeNull()
  })
})

describe('invoice payload', () => {
  const inv = {
    number: 'INV-0007',
    issue_date: '2026-09-05',
    due_date: null,
    gst_rate: 10,
    payment_terms_days: 14,
    job_number: 'RJ26003',
    job_title: 'Cavity clean',
    lines: [
      { description: 'Labour', qty: 2, unit_sell: 150, kind: 'labour' },
      { description: '', qty: 1, unit_sell: 80.5, kind: null },
    ],
  }

  test('maps header, lines, accounts, tax and tracking', () => {
    const p = buildInvoicePayload(inv, mapping, 'contact-1', {
      categoryId: 'cat-1',
      optionId: 'opt-1',
    })
    expect(p.Type).toBe('ACCREC')
    expect(p.Status).toBe('AUTHORISED')
    expect(p.LineAmountTypes).toBe('Exclusive')
    expect(p.Contact).toEqual({ ContactID: 'contact-1' })
    expect(p.InvoiceNumber).toBe('INV-0007')
    expect(p.Reference).toBe('RJ26003 Cavity clean')
    expect(p.Date).toBe('2026-09-05')
    expect(p.DueDate).toBe('2026-09-19') // issue + payment terms when due_date null
    expect(p.LineItems).toEqual([
      {
        Description: 'Labour',
        Quantity: 2,
        UnitAmount: 150,
        AccountCode: '210',
        TaxType: 'OUTPUT',
        Tracking: [{ TrackingCategoryID: 'cat-1', TrackingOptionID: 'opt-1' }],
      },
      {
        Description: '(no description)',
        Quantity: 1,
        UnitAmount: 80.5,
        AccountCode: '200',
        TaxType: 'OUTPUT',
        Tracking: [{ TrackingCategoryID: 'cat-1', TrackingOptionID: 'opt-1' }],
      },
    ])
  })

  test('uses the explicit due date, the no-GST tax type at 0%, and omits tracking when absent', () => {
    const p = buildInvoicePayload(
      { ...inv, due_date: '2026-10-01', gst_rate: 0, job_number: null, job_title: null },
      mapping,
      'c',
      null
    )
    expect(p.DueDate).toBe('2026-10-01')
    expect(p.Reference).toBe('')
    expect(p.LineItems[0].TaxType).toBe('EXEMPTOUTPUT')
    expect(p.LineItems[0].Tracking).toBeUndefined()
  })

  test('truncates the reference to 255 characters', () => {
    const p = buildInvoicePayload(
      { ...inv, job_title: 'x'.repeat(300) },
      mapping,
      'c',
      null
    )
    expect(p.Reference.length).toBe(255)
  })

  test('throws when no account can be resolved', () => {
    expect(() =>
      buildInvoicePayload(inv, { ...mapping, defaultAccount: null }, 'c', null)
    ).toThrow(/income account/)
  })
})

describe('claim payload', () => {
  test('one inclusive line at the certified amount on the claims account', () => {
    const p = buildClaimPayload(
      {
        project_number: 'P-0014',
        project_name: 'Thirroul',
        claim_number: 3,
        certified_amount: 11000,
        reference_date: '2026-08-31',
        payment_terms_days: 30,
      },
      mapping,
      'contact-9',
      { categoryId: 'cat-1', optionId: 'opt-p' }
    )
    expect(p.LineAmountTypes).toBe('Inclusive')
    expect(p.InvoiceNumber).toBe('PC-P-0014-3')
    expect(p.Reference).toBe('P-0014')
    expect(p.Date).toBe('2026-08-31')
    expect(p.DueDate).toBe('2026-09-30')
    expect(p.LineItems).toHaveLength(1)
    expect(p.LineItems[0]).toMatchObject({
      Description: 'Progress claim PC-3 — P-0014 Thirroul',
      Quantity: 1,
      UnitAmount: 11000,
      AccountCode: '230',
      TaxType: 'OUTPUT',
    })
    expect(claimInvoiceNumber('P-0014', 3)).toBe('PC-P-0014-3')
  })

  test('throws when the claims account is unset', () => {
    expect(() =>
      buildClaimPayload(
        {
          project_number: 'P-1',
          project_name: 'x',
          claim_number: 1,
          certified_amount: 1,
          reference_date: '2026-01-01',
          payment_terms_days: 30,
        },
        { ...mapping, claimsAccount: null },
        'c',
        null
      )
    ).toThrow(/claims account/)
  })
})

describe('status derivation (spec §7)', () => {
  test('AUTHORISED with amount due → sent', () => {
    expect(deriveInvoiceStatusFromXero({ Status: 'AUTHORISED', AmountDue: 10 })).toEqual({
      status: 'sent',
      paid_at: null,
    })
  })
  test('AUTHORISED fully credited → paid at the updated date', () => {
    expect(
      deriveInvoiceStatusFromXero({
        Status: 'AUTHORISED',
        AmountDue: 0,
        UpdatedDateUTC: '/Date(1757030400000+0000)/',
      })
    ).toEqual({ status: 'paid', paid_at: '2025-09-05T00:00:00.000Z' })
  })
  test('PAID → paid on FullyPaidOnDate', () => {
    expect(
      deriveInvoiceStatusFromXero({
        Status: 'PAID',
        AmountDue: 0,
        FullyPaidOnDate: '/Date(1757030400000+0000)/',
      })
    ).toEqual({ status: 'paid', paid_at: '2025-09-05T00:00:00.000Z' })
  })
  test('VOIDED → void', () => {
    expect(deriveInvoiceStatusFromXero({ Status: 'VOIDED' })).toEqual({
      status: 'void',
      paid_at: null,
    })
  })
})

describe('misc', () => {
  test('totalsDiffer tolerates 2 cents', () => {
    expect(totalsDiffer(100, 100.02)).toBe(false)
    expect(totalsDiffer(100, 100.03)).toBe(true)
    expect(totalsDiffer(100, undefined)).toBe(false)
  })

  test('workNumberFromReference finds RJ / legacy J- / P- numbers', () => {
    expect(workNumberFromReference('RJ26003 Cavity clean')).toBe('RJ26003')
    expect(workNumberFromReference('re job j-0007')).toBe('J-0007')
    expect(workNumberFromReference('P-0014 claim 2')).toBe('P-0014')
    expect(workNumberFromReference('nothing here')).toBeNull()
    expect(workNumberFromReference(undefined)).toBeNull()
  })

  test('xeroLinesToInvoiceLines copies description/qty/unit price with positions', () => {
    expect(
      xeroLinesToInvoiceLines([
        { Description: 'A', Quantity: 2, UnitAmount: 5 },
        { Description: undefined, Quantity: undefined, UnitAmount: undefined },
      ])
    ).toEqual([
      { description: 'A', qty: 2, unit: 'ea', unit_sell: 5, position: 0 },
      { description: '(no description)', qty: 1, unit: 'ea', unit_sell: 0, position: 1 },
    ])
  })

  test('xeroErrorMessage digs out validation messages', () => {
    expect(
      xeroErrorMessage({
        Elements: [{ ValidationErrors: [{ Message: 'Invoice # must be unique.' }] }],
      })
    ).toBe('Invoice # must be unique.')
    expect(xeroErrorMessage({ Detail: 'TokenExpired' })).toBe('TokenExpired')
    expect(xeroErrorMessage({ Title: 'Forbidden' })).toBe('Forbidden')
    expect(xeroErrorMessage(null)).toBe('Xero request failed')
  })
})
