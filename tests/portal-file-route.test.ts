import { beforeEach, expect, test, vi } from 'vitest'

/**
 * /portal/[token]/file/[kind]/[fileId]: a PDF that backs a SWMS is served as
 * the signed copy (original + sign-on register); everything else keeps the
 * signed-URL redirect. portal_file_path stays the single entitlement gate.
 */
const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  limit: vi.fn(),
  createSignedUrl: vi.fn(),
  buildSwmsPdfResponse: vi.fn(),
}))

vi.mock('@/lib/supabase/public', () => ({ createPublicClient: () => ({ rpc: m.rpc }) }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: () => ({ limit: m.limit }) }) }),
    }),
    storage: { from: () => ({ createSignedUrl: m.createSignedUrl }) },
  }),
}))
vi.mock('@/pdf/build-swms-pdf', () => ({ buildSwmsPdfResponse: m.buildSwmsPdfResponse }))

import { GET } from '@/app/portal/[token]/file/[kind]/[fileId]/route'

const FILE_ID = '11111111-1111-1111-1111-111111111111'

function get(kind: string) {
  return GET(new Request('http://portal.test/'), {
    params: Promise.resolve({ token: 'tok', kind, fileId: FILE_ID }),
  })
}

beforeEach(() => {
  m.rpc.mockReset().mockResolvedValue({ data: { path: 'job/x.pdf', filename: 'x.pdf' } })
  m.limit.mockReset().mockResolvedValue({ data: [] })
  m.createSignedUrl
    .mockReset()
    .mockResolvedValue({ data: { signedUrl: 'https://storage.test/signed' }, error: null })
  m.buildSwmsPdfResponse
    .mockReset()
    .mockResolvedValue(new Response('pdf', { headers: { 'Content-Type': 'application/pdf' } }))
})

test('a PDF that backs a SWMS is served as the signed copy, uncached', async () => {
  m.limit.mockResolvedValue({ data: [{ id: 'swms-1' }] })

  const res = await get('attachment')

  expect(m.buildSwmsPdfResponse).toHaveBeenCalledWith(expect.anything(), 'swms-1')
  expect(res.status).toBe(200)
  expect(res.headers.get('Content-Type')).toBe('application/pdf')
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect(m.createSignedUrl).not.toHaveBeenCalled()
})

test('a plain attachment still redirects to a short-lived signed URL', async () => {
  const res = await get('attachment')

  expect(res.status).toBe(302)
  expect(res.headers.get('location')).toBe('https://storage.test/signed')
  expect(m.buildSwmsPdfResponse).not.toHaveBeenCalled()
})

test('compliance evidence never consults the SWMS table', async () => {
  const res = await get('item')

  expect(m.limit).not.toHaveBeenCalled()
  expect(res.status).toBe(302)
})

test('an unentitled link is refused before anything is looked up or built', async () => {
  m.rpc.mockResolvedValue({ data: null })

  const res = await get('attachment')

  expect(res.status).toBe(404)
  expect(m.limit).not.toHaveBeenCalled()
  expect(m.buildSwmsPdfResponse).not.toHaveBeenCalled()
})
