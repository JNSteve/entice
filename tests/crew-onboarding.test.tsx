// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

const createUser = vi.fn(async (_d: unknown) => ({ id: 'u1' }))
const changePassword = vi.fn(async (_p: string, _c: string) => ({}))
vi.mock('@/app/(office)/settings/actions', () => ({
  createUser: (d: unknown) => createUser(d),
  updateProfile: vi.fn(),
}))
vi.mock('@/lib/auth-actions', () => ({ changePassword: (p: string, c: string) => changePassword(p, c) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/settings' }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))

import { loginMessage, UsersSection } from '@/app/(office)/settings/users-section'
import { ChangePasswordForm } from '@/app/field/account/change-password-form'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('login message points crew at /field with install and password steps', () => {
  const msg = loginMessage({
    fullName: 'Sam Brown', email: 'sam@ecr.com.au', password: 'Reef-4827-Crane',
    origin: 'https://entice-pink.vercel.app', role: 'field',
  })
  expect(msg).toContain('Hi Sam')
  expect(msg).toContain('https://entice-pink.vercel.app/field')
  expect(msg).toContain('Reef-4827-Crane')
  expect(msg).toContain('Add to Home Screen')
  expect(msg).toContain('key icon')
  expect(loginMessage({ fullName: 'Ann Lee', email: 'a@b.c', password: 'x', origin: 'https://o', role: 'office' }))
    .toContain('open: https://o\n')
})

test('new user form sends hourly cost and shows the login message', async () => {
  const user = userEvent.setup()
  render(<UsersSection profiles={[]} currentUserId="me" />)
  await user.click(screen.getByRole('button', { name: /new user/i }))
  await user.type(screen.getByLabelText('Full name'), 'Sam Brown')
  await user.type(screen.getByLabelText(/Email/), 'sam@ecr.com.au')
  await user.click(screen.getByRole('button', { name: 'Generate' }))
  const money = screen.getAllByPlaceholderText('0.00').at(-1)!
  await user.type(money, '55')
  await user.tab()
  await user.click(screen.getByRole('button', { name: 'Create user' }))

  expect(createUser).toHaveBeenCalledWith(
    expect.objectContaining({ full_name: 'Sam Brown', role: 'field', hourly_cost: 55 })
  )
  const pw = (createUser.mock.calls[0][0] as { password: string }).password
  expect(pw).toMatch(/^[A-Z][a-z]+-\d{4}-[A-Z][a-z]+$/)
  const box = (await screen.findByLabelText('Login details')) as HTMLTextAreaElement
  expect(box.value).toContain(pw)
  expect(box.value).toContain('/field')
})

test('change password form submits both fields', async () => {
  const user = userEvent.setup()
  render(<ChangePasswordForm />)
  await user.type(screen.getByLabelText('New password'), 'NewPass123')
  await user.type(screen.getByLabelText('Type it again'), 'NewPass123')
  await user.click(screen.getByRole('button', { name: 'Change password' }))
  expect(changePassword).toHaveBeenCalledWith('NewPass123', 'NewPass123')
})
