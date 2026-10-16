// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'

// Chainable stand-in for the attachments query; records every call so tests
// can assert the filters that reached Supabase.
const queryCalls: Array<[string, unknown[]]> = []
let queryRows: unknown[] = []
function queryBuilder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'gte', 'in', 'order']) {
    b[m] = (...args: unknown[]) => {
      queryCalls.push([m, args])
      return b
    }
  }
  b.then = (resolve: (v: unknown) => void) => resolve({ data: queryRows })
  return b
}
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => queryBuilder(),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((p) => ({ path: p, signedUrl: `https://signed/${p}` })),
        }),
      }),
    },
  }),
}))
vi.mock('@/lib/attachments', () => ({ recordAttachment: vi.fn(async () => ({ id: 'a1' })) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { PhotoUpload } from '@/components/PhotoUpload'
import { CaptureClient, type CaptureTarget } from '@/app/field/photo/capture-client'

afterEach(() => {
  cleanup()
  queryCalls.length = 0
  queryRows = []
})

function fileInputs(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[type="file"]'))
}

const wharf: CaptureTarget = { id: 'job-1', type: 'job', number: 'RJ26018', label: '24-30 Wharf St' }

// iOS opens the camera directly for any input carrying `capture`, with no way
// to pick existing photos — the library input must never carry it.

test('PhotoUpload with capture offers a camera input and a separate library input', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <PhotoUpload parentType="job" parentId="job-1" kind="photo" capture multiple />
  )
  const inputs = fileInputs(container)
  const library = inputs.filter((i) => !i.hasAttribute('capture'))
  const camera = inputs.filter((i) => i.getAttribute('capture') === 'environment')
  expect(library).toHaveLength(1)
  expect(camera).toHaveLength(1)
  expect(library[0].multiple).toBe(true)
  expect(library[0].accept).toBe('image/*')

  const cameraClick = vi.spyOn(camera[0], 'click')
  const libraryClick = vi.spyOn(library[0], 'click')
  await user.click(screen.getByRole('button', { name: /take photo/i }))
  expect(cameraClick).toHaveBeenCalledOnce()
  expect(libraryClick).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: /choose from library/i }))
  expect(libraryClick).toHaveBeenCalledOnce()
})

test('PhotoUpload without capture keeps a single plain input', () => {
  const { container } = render(
    <PhotoUpload parentType="job" parentId="job-1" kind="document" multiple />
  )
  const inputs = fileInputs(container)
  expect(inputs).toHaveLength(1)
  expect(inputs[0].hasAttribute('capture')).toBe(false)
  expect(screen.queryByRole('button', { name: /take photo/i })).toBeNull()
  expect(screen.getByRole('button', { name: /attach file/i })).toBeTruthy()
})

test('field capture page: photo mode has camera + library inputs, docket mode has no capture', async () => {
  const user = userEvent.setup()
  const { container } = render(
    <CaptureClient recentTargets={[wharf]} allTargets={[wharf]} today="2026-10-07" />
  )
  let inputs = fileInputs(container)
  const library = inputs.filter((i) => !i.hasAttribute('capture'))
  const camera = inputs.filter((i) => i.getAttribute('capture') === 'environment')
  expect(library).toHaveLength(1)
  expect(camera).toHaveLength(1)
  expect(library[0].multiple).toBe(true)

  const cameraClick = vi.spyOn(camera[0], 'click')
  await user.click(screen.getByRole('button', { name: /take photo/i }))
  expect(cameraClick).toHaveBeenCalledOnce()

  await user.click(screen.getByRole('button', { name: /docket/i }))
  inputs = fileInputs(container)
  expect(inputs).toHaveLength(1)
  expect(inputs[0].hasAttribute('capture')).toBe(false)
})

test('field capture page loads the pre-selected target\'s uploads from Brisbane midnight', async () => {
  queryRows = [
    {
      id: 'att-1', filename: 'IMG_0412.jpg', kind: 'photo', caption: 'Trimmed plastic',
      meta: null, created_at: '2026-10-06T21:15:00Z', path: 'job/job-1/x-IMG_0412.jpg',
    },
  ]
  render(<CaptureClient recentTargets={[wharf]} allTargets={[wharf]} today="2026-10-07" />)

  // Shown without tapping the chip — the page opens with Wharf St selected.
  expect(await screen.findByText('IMG_0412.jpg')).toBeTruthy()
  expect(screen.getByText('Uploaded today')).toBeTruthy()

  // 7:15am Brisbane is "today": the window starts at 00:00 +10:00, not 00:00 UTC.
  await waitFor(() => expect(queryCalls.some(([m]) => m === 'gte')).toBe(true))
  expect(queryCalls.find(([m]) => m === 'gte')?.[1]).toEqual([
    'created_at',
    '2026-10-06T14:00:00.000Z',
  ])
  expect(queryCalls).toContainEqual(['eq', ['parent_id', 'job-1']])
})
