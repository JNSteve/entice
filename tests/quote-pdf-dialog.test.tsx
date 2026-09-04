// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// The two server actions the dialog calls, and the router/toast it reports through.
const applyQuoteTemplate = vi.fn()
const updateQuotePdfOptions = vi.fn()
const refresh = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('../src/app/(office)/quotes/actions', () => ({
  applyQuoteTemplate: (...args: unknown[]) => applyQuoteTemplate(...args),
  updateQuotePdfOptions: (...args: unknown[]) => updateQuotePdfOptions(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('sonner', () => ({
  toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) },
}))

import { QuotePdfDialog } from '../src/app/(office)/quotes/[id]/quote-pdf-dialog'
import { DEFAULT_PRICING, starterDoc } from '../src/lib/quote-doc'
import type { QuoteData } from '../src/app/(office)/quotes/[id]/quote-builder'

const TEMPLATE_ID = '11111111-1111-4111-8111-111111111111'

function quote(overrides: Partial<QuoteData> = {}): QuoteData {
  return {
    id: 'q-1',
    number: 'RQ26011',
    title: 'Removal',
    description: null,
    status: 'draft',
    gst_rate: 10,
    valid_days: 14,
    sent_at: null,
    decided_at: null,
    lost_reason: null,
    client_id: 'c-1',
    site_id: null,
    contact_id: null,
    client_name: 'Acme',
    site_name: null,
    contact_name: null,
    pm_id: null,
    pm_name: null,
    converted_to: null,
    converted_id: null,
    converted_number: null,
    archived: false,
    portal_published: false,
    portal_acceptance: null,
    template_id: TEMPLATE_ID,
    template_name: 'Bonded Asbestos Removal',
    doc: starterDoc(),
    template_state: 'template_changed',
    pdf_options: { ...DEFAULT_PRICING, mode: 'lump_sum' },
    ...overrides,
  }
}

const templates = [
  { id: TEMPLATE_ID, name: 'Bonded Asbestos Removal', is_default: false, pricing_defaults: { ...DEFAULT_PRICING, mode: 'lump_sum' as const } },
]

let tab: { location: { href: string }; close: ReturnType<typeof vi.fn> }

beforeEach(() => {
  tab = { location: { href: '' }, close: vi.fn() }
  vi.stubGlobal('open', vi.fn(() => tab))
  // jsdom lacks these; Base UI's popup layer reads them.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  applyQuoteTemplate.mockReset()
  updateQuotePdfOptions.mockReset().mockResolvedValue({})
  refresh.mockReset()
  toastSuccess.mockReset()
  toastError.mockReset()
})
afterEach(cleanup)

/** Buttons are disabled while a transition is pending; wait for the real one. */
async function clickWhenEnabled(name: RegExp) {
  await waitFor(() => {
    const el = screen.getByRole('button', { name }) as HTMLButtonElement
    expect(el.disabled).toBe(false)
  })
  fireEvent.click(screen.getByRole('button', { name }))
}

async function openDialog() {
  render(<QuotePdfDialog quote={quote()} templates={templates} editable />)
  fireEvent.click(screen.getByRole('button', { name: /pdf/i }))
  await screen.findByText('Quote PDF')
}

describe('QuotePdfDialog', () => {
  test('a silently refreshed draft opens straight away and says so', async () => {
    applyQuoteTemplate.mockResolvedValue({ refreshed: true })
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: /open pdf/i }))
    await waitFor(() => expect(tab.location.href).toBe('/api/pdf/quote/q-1'))
    expect(applyQuoteTemplate).toHaveBeenCalledWith('q-1', TEMPLATE_ID, { force: false })
    expect(updateQuotePdfOptions).toHaveBeenCalledWith('q-1', expect.objectContaining({ mode: 'lump_sum' }))
    expect(toastSuccess).toHaveBeenCalledWith('Updated from the template')
    expect(tab.close).not.toHaveBeenCalled()
  })

  test('when the server asks first, the tab closes and the choice is offered in place', async () => {
    applyQuoteTemplate.mockResolvedValueOnce({ needsConfirm: true })
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: /open pdf/i }))
    await screen.findByText(/differs from the template/i)
    expect(tab.close).toHaveBeenCalled()
    expect(updateQuotePdfOptions).not.toHaveBeenCalled()

    // "Use the template" forces the write and then opens the PDF.
    applyQuoteTemplate.mockResolvedValueOnce({})
    await clickWhenEnabled(/use the template/i)
    await waitFor(() => expect(applyQuoteTemplate).toHaveBeenLastCalledWith('q-1', TEMPLATE_ID, { force: true }))
    await waitFor(() => expect(updateQuotePdfOptions).toHaveBeenCalled())
  })

  test('keeping the quote wording opens the PDF without touching the template copy', async () => {
    applyQuoteTemplate.mockResolvedValueOnce({ needsConfirm: true })
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: /open pdf/i }))
    await screen.findByText(/differs from the template/i)
    await clickWhenEnabled(/keep this quote/i)
    await waitFor(() => expect(updateQuotePdfOptions).toHaveBeenCalled())
    expect(applyQuoteTemplate).toHaveBeenCalledTimes(1)
  })

  test('an action error closes the tab and reports it', async () => {
    applyQuoteTemplate.mockResolvedValue({ error: 'Template is invalid — fix it in Settings' })
    await openDialog()
    fireEvent.click(screen.getByRole('button', { name: /open pdf/i }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Template is invalid — fix it in Settings'))
    expect(tab.close).toHaveBeenCalled()
    expect(updateQuotePdfOptions).not.toHaveBeenCalled()
  })

  test('a frozen quote never writes and just opens the saved layout', async () => {
    render(<QuotePdfDialog quote={quote({ status: 'accepted' })} templates={templates} editable={false} />)
    fireEvent.click(screen.getByRole('button', { name: /pdf/i }))
    await screen.findByText('Quote PDF')
    fireEvent.click(screen.getByRole('button', { name: /open pdf/i }))
    await waitFor(() => expect(tab.location.href).toBe('/api/pdf/quote/q-1'))
    expect(applyQuoteTemplate).not.toHaveBeenCalled()
    expect(updateQuotePdfOptions).not.toHaveBeenCalled()
  })
})
