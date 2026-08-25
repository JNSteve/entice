// @vitest-environment jsdom
//
// The root error boundary must self-heal from stale-deployment chunk errors:
// a client running an old build that lazy-loads a chunk the server no longer
// has (ChunkLoadError) gets ONE automatic full reload — which fetches fresh
// HTML pointing at current chunks — instead of a scary error card that "Try
// again" can never fix. A sessionStorage cooldown stops reload loops, and
// auto-healed cases are NOT reported into app_errors (the register showed 6
// rows for one such incident on 2026-08-25).
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import ErrorPage from '@/app/error'
import { reportAppError } from '@/lib/error-log'
import { RELOAD_STORAGE_KEY } from '@/lib/stale-chunk'

vi.mock('@/lib/error-log', () => ({ reportAppError: vi.fn() }))
// Plain anchor stand-in — the boundary renders outside a Next router here.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.ComponentProps<'a'>) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

const CHUNK_ERROR = Object.assign(
  new Error(
    'Failed to load chunk /_next/static/chunks/0shfufsib1dqr.js from module 964893'
  ),
  { name: 'ChunkLoadError' }
)

const NORMAL_ERROR = new Error('boom')

beforeEach(() => {
  window.sessionStorage.clear()
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('root error boundary', () => {
  it('shows the error card and reports for a normal error', async () => {
    render(<ErrorPage error={NORMAL_ERROR} unstable_retry={() => {}} />)

    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
    expect(reportAppError).toHaveBeenCalledTimes(1)
    expect(reportAppError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'boom' })
    )
  })

  it('auto-reloads on a stale chunk error without reporting or alarming', async () => {
    render(<ErrorPage error={CHUNK_ERROR} unstable_retry={() => {}} />)

    // Calm updating state — never the error card.
    expect(await screen.findByText(/latest version/i)).toBeTruthy()
    expect(screen.queryByText('Something went wrong')).toBeNull()
    // The reload attempt was recorded (the reload itself is a browser no-op
    // under jsdom) and nothing was reported — the reload heals it.
    expect(window.sessionStorage.getItem(RELOAD_STORAGE_KEY)).not.toBeNull()
    expect(reportAppError).not.toHaveBeenCalled()
  })

  it('falls back to the error card, with a reload button, when a reload already ran', async () => {
    // A reload attempt moments ago means reloading again cannot help.
    window.sessionStorage.setItem(RELOAD_STORAGE_KEY, String(Date.now()))

    render(<ErrorPage error={CHUNK_ERROR} unstable_retry={() => {}} />)

    expect(await screen.findByText('Something went wrong')).toBeTruthy()
    // A full reload is the only action that can fix a chunk error — soft
    // retry re-renders inside the same stale bundle.
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
    expect(reportAppError).toHaveBeenCalledTimes(1)
  })
})
