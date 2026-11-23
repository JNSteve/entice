// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const addFormSignon = vi.fn(async (...args: unknown[]) => {
  void args
  return {} as { error?: string }
})
vi.mock('@/app/field/safety/actions', () => ({
  addFormSignon: (...args: unknown[]) => addFormSignon(...args),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
// The real pad draws on a canvas; here one tap "draws" a valid signature.
vi.mock('@/components/SignaturePad', () => ({
  SignaturePad: ({ onChange }: { onChange: (d: string | null) => void }) => (
    <button type="button" onClick={() => onChange('data:image/png;base64,AAAA')}>
      draw signature
    </button>
  ),
}))

import { SignonSection } from '@/app/field/safety/submission/[id]/signon-section'

afterEach(() => {
  cleanup()
  addFormSignon.mockClear()
})

const base = {
  submissionId: '11111111-1111-4111-8111-111111111111',
  defaultName: 'Jack Labour',
  alreadySignedSelf: false,
  canRecordOthers: false,
}

test('someone who has not signed sees just a Sign on button', () => {
  render(<SignonSection {...base} />)
  expect(screen.getByRole('button', { name: 'Sign on' })).toBeTruthy()
  // The signature pad stays out of the way until they ask for it.
  expect(screen.queryByText('draw signature')).toBeNull()
})

test('Sign on opens the pad with their name, and confirming records their own sign-on', async () => {
  const user = userEvent.setup()
  render(<SignonSection {...base} />)

  await user.click(screen.getByRole('button', { name: 'Sign on' }))
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Jack Labour')

  const confirm = screen.getByRole('button', { name: 'Confirm sign-on' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)

  await user.click(screen.getByText('draw signature'))
  await user.click(screen.getByRole('button', { name: 'Confirm sign-on' }))

  expect(addFormSignon).toHaveBeenCalledTimes(1)
  expect(addFormSignon).toHaveBeenCalledWith({
    submission_id: base.submissionId,
    name: 'Jack Labour',
    company: null,
    signature: 'data:image/png;base64,AAAA',
    self: true,
  })
})

test('Cancel closes the pad without signing', async () => {
  const user = userEvent.setup()
  render(<SignonSection {...base} />)

  await user.click(screen.getByRole('button', { name: 'Sign on' }))
  await user.click(screen.getByRole('button', { name: 'Cancel' }))

  expect(screen.queryByText('draw signature')).toBeNull()
  expect(screen.getByRole('button', { name: 'Sign on' })).toBeTruthy()
  expect(addFormSignon).not.toHaveBeenCalled()
})

test('someone who has already signed is not offered Sign on again', () => {
  render(<SignonSection {...base} alreadySignedSelf />)
  expect(screen.queryByRole('button', { name: 'Sign on' })).toBeNull()
})

test('only people allowed to record others see the pass-the-phone button', () => {
  const { rerender } = render(<SignonSection {...base} />)
  expect(screen.queryByRole('button', { name: /Others sign on this device/ })).toBeNull()

  rerender(<SignonSection {...base} canRecordOthers />)
  expect(screen.getByRole('button', { name: /Others sign on this device/ })).toBeTruthy()
})
