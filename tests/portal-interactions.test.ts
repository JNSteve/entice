import { describe, expect, it } from 'vitest'
import {
  acceptanceWording,
  canConvertRequest,
  canPublishQuote,
  canPublishVariation,
  canSignApproval,
  canTransitionRequest,
  countInWindow,
  MESSAGE_RATE_LIMIT,
  photoUploadProblem,
  rateLimited,
  REQUEST_RATE_LIMIT,
  REQUEST_TIMELINE,
  REQUEST_TRANSITIONS,
  requestTimelineIndex,
  UPLOAD_RATE_LIMIT,
} from '@/lib/portal-interactions'

// ─── Request status flow ─────────────────────────────────────────────────────

describe('request status flow', () => {
  it('orders the client timeline submitted → completed', () => {
    expect(REQUEST_TIMELINE).toEqual([
      'submitted',
      'reviewed',
      'quoted',
      'scheduled',
      'completed',
    ])
    expect(requestTimelineIndex('submitted')).toBe(0)
    expect(requestTimelineIndex('completed')).toBe(4)
  })

  it('declined sits off the timeline', () => {
    expect(requestTimelineIndex('declined')).toBe(-1)
    expect(requestTimelineIndex('junk')).toBe(-1)
  })

  it('allows forward transitions and declining open requests', () => {
    expect(canTransitionRequest('submitted', 'reviewed')).toBe(true)
    expect(canTransitionRequest('submitted', 'scheduled')).toBe(true) // skip ok
    expect(canTransitionRequest('reviewed', 'quoted')).toBe(true)
    expect(canTransitionRequest('quoted', 'completed')).toBe(true)
    expect(canTransitionRequest('scheduled', 'completed')).toBe(true)
    expect(canTransitionRequest('submitted', 'declined')).toBe(true)
    expect(canTransitionRequest('scheduled', 'declined')).toBe(true)
  })

  it('never moves backwards or out of a terminal state', () => {
    expect(canTransitionRequest('reviewed', 'submitted')).toBe(false)
    expect(canTransitionRequest('quoted', 'reviewed')).toBe(false)
    expect(canTransitionRequest('completed', 'declined')).toBe(false)
    expect(canTransitionRequest('declined', 'submitted')).toBe(false)
    expect(REQUEST_TRANSITIONS.completed).toEqual([])
    expect(REQUEST_TRANSITIONS.declined).toEqual([])
  })

  it('rejects unknown statuses outright', () => {
    expect(canTransitionRequest('junk', 'reviewed')).toBe(false)
    expect(canTransitionRequest('submitted', 'junk')).toBe(false)
  })

  it('convert-to-quote only while triaging and only once', () => {
    expect(canConvertRequest('submitted', null)).toBe(true)
    expect(canConvertRequest('reviewed', null)).toBe(true)
    expect(canConvertRequest('quoted', null)).toBe(false)
    expect(canConvertRequest('declined', null)).toBe(false)
    // already linked to a quote — never twice
    expect(canConvertRequest('submitted', 'some-quote-id')).toBe(false)
  })
})

// ─── Approval gating ─────────────────────────────────────────────────────────

describe('approval gating', () => {
  it('quotes are signable only when published AND sent', () => {
    expect(canSignApproval('quote', 'sent', true)).toBe(true)
    expect(canSignApproval('quote', 'sent', false)).toBe(false) // unpublished
    expect(canSignApproval('quote', 'draft', true)).toBe(false)
    expect(canSignApproval('quote', 'accepted', true)).toBe(false) // double-accept
    expect(canSignApproval('quote', 'lost', true)).toBe(false)
  })

  it('variations are signable only when published AND submitted', () => {
    expect(canSignApproval('variation', 'submitted', true)).toBe(true)
    expect(canSignApproval('variation', 'submitted', false)).toBe(false)
    expect(canSignApproval('variation', 'notified', true)).toBe(false)
    expect(canSignApproval('variation', 'priced', true)).toBe(false)
    expect(canSignApproval('variation', 'approved', true)).toBe(false)
    expect(canSignApproval('variation', 'rejected', true)).toBe(false)
  })

  it('office may only publish signable variations', () => {
    expect(canPublishVariation('submitted')).toBe(true)
    expect(canPublishVariation('priced')).toBe(false)
    expect(canPublishVariation('approved')).toBe(false)
  })

  it('acceptance wording names the document and the client', () => {
    expect(acceptanceWording('Q-0012', 'Mermaid Beach Bowls Club')).toBe(
      'By signing, you confirm acceptance of Q-0012 on behalf of Mermaid Beach Bowls Club.'
    )
  })
})

// ─── Rate-limit windows ──────────────────────────────────────────────────────

describe('rate-limit windows', () => {
  const now = '2026-07-05T12:00:00.000Z'

  it('counts only events inside the rolling window', () => {
    const events = [
      '2026-07-05T11:59:00.000Z', // 1 min ago — in
      '2026-07-05T11:00:00.001Z', // just inside the hour — in
      '2026-07-05T11:00:00.000Z', // exactly window edge — out (strict >)
      '2026-07-05T10:00:00.000Z', // 2h ago — out
      'not-a-date', // ignored
    ]
    expect(countInWindow(events, now, MESSAGE_RATE_LIMIT.windowMs)).toBe(2)
  })

  it('messages: the 21st in an hour is rejected, the 21st across hours is not', () => {
    const burst = Array.from({ length: 20 }, (_, i) =>
      new Date(Date.parse(now) - i * 60_000).toISOString()
    )
    expect(rateLimited(burst, now, MESSAGE_RATE_LIMIT)).toBe(true)
    expect(rateLimited(burst.slice(1), now, MESSAGE_RATE_LIMIT)).toBe(false)

    // Same 20 messages spread over > an hour — window has drained.
    const spread = Array.from({ length: 20 }, (_, i) =>
      new Date(Date.parse(now) - (i + 1) * 4 * 60_000).toISOString()
    )
    expect(countInWindow(spread, now, MESSAGE_RATE_LIMIT.windowMs)).toBe(14)
    expect(rateLimited(spread, now, MESSAGE_RATE_LIMIT)).toBe(false)
  })

  it('requests: the 11th in 24h is rejected', () => {
    const ten = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.parse(now) - i * 60 * 60_000).toISOString()
    )
    expect(rateLimited(ten, now, REQUEST_RATE_LIMIT)).toBe(true)
    expect(rateLimited(ten.slice(0, 9), now, REQUEST_RATE_LIMIT)).toBe(false)
  })

  it('uploads: 40/day ceiling', () => {
    const forty = Array.from({ length: 40 }, (_, i) =>
      new Date(Date.parse(now) - i * 60_000).toISOString()
    )
    expect(rateLimited(forty, now, UPLOAD_RATE_LIMIT)).toBe(true)
    expect(rateLimited(forty.slice(1), now, UPLOAD_RATE_LIMIT)).toBe(false)
  })
})

// ─── Photo upload constraints ────────────────────────────────────────────────

describe('photo upload constraints', () => {
  const jpeg = (size: number) => ({ type: 'image/jpeg', size })

  it('accepts up to five images under 10MB', () => {
    expect(photoUploadProblem([jpeg(5_000_000)])).toBeNull()
    expect(photoUploadProblem(Array.from({ length: 5 }, () => jpeg(1000)))).toBeNull()
  })

  it('rejects a sixth file', () => {
    expect(
      photoUploadProblem(Array.from({ length: 6 }, () => jpeg(1000)))
    ).toMatch(/maximum of 5/i)
  })

  it('rejects oversize and empty files', () => {
    expect(photoUploadProblem([jpeg(10 * 1024 * 1024 + 1)])).toMatch(/10MB/)
    expect(photoUploadProblem([jpeg(0)])).toMatch(/10MB/)
    expect(photoUploadProblem([jpeg(10 * 1024 * 1024)])).toBeNull()
  })

  it('rejects non-image types', () => {
    expect(photoUploadProblem([{ type: 'application/pdf', size: 1000 }])).toMatch(
      /JPEG, PNG, WebP or GIF/
    )
    expect(photoUploadProblem([{ type: 'image/svg+xml', size: 1000 }])).toMatch(
      /JPEG, PNG, WebP or GIF/
    )
  })

  it('rejects an empty selection', () => {
    expect(photoUploadProblem([])).toMatch(/no files/i)
  })
})

describe('canPublishQuote', () => {
  it('sent and accepted quotes can sit on the portal; drafts and lost cannot', () => {
    expect(canPublishQuote('sent')).toBe(true)
    expect(canPublishQuote('accepted')).toBe(true)
    expect(canPublishQuote('draft')).toBe(false)
    expect(canPublishQuote('lost')).toBe(false)
  })
})
