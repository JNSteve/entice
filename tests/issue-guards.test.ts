import { describe, expect, it } from 'vitest'
import { deriveJobStatusFromInvoices, issueProblem } from '@/lib/issue-guards'

describe('issueProblem', () => {
  it('blocks an empty quote or invoice', () => {
    expect(issueProblem([], 'quote')).toMatch(/at least one line/)
    expect(issueProblem([], 'invoice')).toMatch(/at least one line/)
  })

  it('blocks a $0 total', () => {
    expect(issueProblem([{ qty: 1, unitSell: 0 }], 'quote')).toMatch(/\$0/)
    expect(issueProblem([{ qty: 0, unitSell: 100 }], 'invoice')).toMatch(/\$0/)
  })

  it('allows a priced document', () => {
    expect(issueProblem([{ qty: 2, unitSell: 50 }], 'quote')).toBeNull()
  })
})

describe('deriveJobStatusFromInvoices', () => {
  it('never touches pre-completion statuses', () => {
    expect(deriveJobStatusFromInvoices('scheduled', ['sent'])).toBeNull()
    expect(deriveJobStatusFromInvoices('in_progress', ['paid'])).toBeNull()
  })

  it('completed → invoiced when an invoice is issued', () => {
    expect(deriveJobStatusFromInvoices('completed', ['sent'])).toBe('invoiced')
    expect(deriveJobStatusFromInvoices('completed', ['draft'])).toBeNull()
  })

  it('→ paid only when every non-void invoice is paid', () => {
    expect(deriveJobStatusFromInvoices('invoiced', ['paid', 'void'])).toBe('paid')
    expect(deriveJobStatusFromInvoices('invoiced', ['paid', 'sent'])).toBeNull()
  })

  it('reverses: paid → invoiced when a settling payment is removed', () => {
    expect(deriveJobStatusFromInvoices('paid', ['sent'])).toBe('invoiced')
  })

  it('reverses: invoiced → completed when the last issued invoice is voided', () => {
    expect(deriveJobStatusFromInvoices('invoiced', ['void'])).toBe('completed')
    expect(deriveJobStatusFromInvoices('invoiced', ['void', 'draft'])).toBe('completed')
    expect(deriveJobStatusFromInvoices('paid', [])).toBe('completed')
  })

  it('returns null when nothing changes', () => {
    expect(deriveJobStatusFromInvoices('invoiced', ['sent'])).toBeNull()
    expect(deriveJobStatusFromInvoices('completed', [])).toBeNull()
  })
})
