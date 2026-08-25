import { describe, expect, test } from 'vitest'
import manifest from '../src/app/manifest'

// The PWA must install correctly for BOTH audiences: office/admin land on the
// dashboard, field crew get bounced to /field by requireRole. Pinning
// start_url to '/' (the role-router) rather than /field keeps one install
// working for everyone.
describe('PWA manifest', () => {
  const m = manifest()

  test('start_url is the role-routed root, not the field app', () => {
    expect(m.start_url).toBe('/')
  })

  test('installs as a standalone app', () => {
    expect(m.display).toBe('standalone')
    expect(m.scope).toBe('/')
  })

  test('ships the PNG icons iOS and Android need', () => {
    const pngs = (m.icons ?? []).filter((i) => i.type === 'image/png')
    const sizes = pngs.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`)
    expect(sizes).toContain('192x192:any')
    expect(sizes).toContain('512x512:any')
    expect(sizes).toContain('192x192:maskable')
    expect(sizes).toContain('512x512:maskable')
  })
})
