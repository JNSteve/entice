import { describe, expect, it } from 'vitest'
import {
  alreadySentToday,
  emailConfig,
  escapeHtml,
  renderEmail,
} from '@/lib/email'
import { digestLine, pickLiveLink, primaryContactEmail } from '@/lib/notify'
import { averageRating } from '@/lib/objectives'

// ─── Template render ─────────────────────────────────────────────────────────

describe('renderEmail', () => {
  const base = {
    companyName: 'ECR Contracting',
    heading: 'New work request',
  }

  it('renders the navy header band with the company name', () => {
    const html = renderEmail(base)
    expect(html).toContain('#1e3a5f')
    expect(html).toContain('ECR Contracting')
    expect(html).toContain('New work request')
  })

  it('renders the portal footer line', () => {
    expect(renderEmail(base)).toContain(
      'ECR Contracting — sent via the client portal'
    )
  })

  it('escapes interpolated HTML everywhere it lands', () => {
    const html = renderEmail({
      companyName: 'A<B',
      heading: '<script>alert(1)</script>',
      intro: 'x & y',
      rows: [{ label: '<b>', value: '"quoted"' }],
      listItems: ["it's <li>"],
      quote: '<img src=x>',
      cta: { label: '<a>', url: 'https://example.com/?a=1&b=2' },
      footnote: '<i>',
    })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('x &amp; y')
    expect(html).toContain('https://example.com/?a=1&amp;b=2')
  })

  it('omits optional blocks when absent', () => {
    const html = renderEmail(base)
    expect(html).not.toContain('<table')
    expect(html).not.toContain('<ul')
    expect(html).not.toContain('<a href')
  })

  it('renders rows, list items, quote and CTA when provided', () => {
    const html = renderEmail({
      ...base,
      rows: [{ label: 'Request', value: 'REQ-0002 — Roof leak' }],
      listItems: ['Depot — Asbestos register: due 15/07/2026'],
      quote: 'Please call before attending.',
      cta: { label: 'Open your portal', url: 'https://example.com/portal/x' },
    })
    expect(html).toContain('REQ-0002 — Roof leak')
    expect(html).toContain('Depot — Asbestos register: due 15/07/2026')
    expect(html).toContain('Please call before attending.')
    expect(html).toContain('https://example.com/portal/x')
    expect(html).toContain('Open your portal')
  })
})

describe('escapeHtml', () => {
  it('escapes the five significant characters', () => {
    expect(escapeHtml(`<a href="x" & 'y'>`)).toBe(
      '&lt;a href=&quot;x&quot; &amp; &#39;y&#39;&gt;'
    )
  })
})

describe('emailConfig', () => {
  it('is unconfigured unless BOTH key and from address exist', () => {
    // The test environment has neither var set.
    const config = emailConfig()
    expect(config.configured).toBe(
      Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM)
    )
  })
})

// ─── Digest idempotency ──────────────────────────────────────────────────────

describe('alreadySentToday', () => {
  const TODAY = '2026-07-06'

  it('is false with no prior attempts', () => {
    expect(alreadySentToday([], TODAY)).toBe(false)
  })

  it('counts a sent attempt from the same Brisbane day', () => {
    // 2026-07-05T21:00Z = 2026-07-06 07:00 Brisbane — same AU day.
    expect(
      alreadySentToday(
        [{ created_at: '2026-07-05T21:00:00Z', status: 'sent' }],
        TODAY
      )
    ).toBe(true)
  })

  it('counts a skipped (unconfigured) attempt as done for the day', () => {
    expect(
      alreadySentToday(
        [{ created_at: '2026-07-06T01:00:00Z', status: 'skipped' }],
        TODAY
      )
    ).toBe(true)
  })

  it('ignores failed attempts so the next run retries', () => {
    expect(
      alreadySentToday(
        [{ created_at: '2026-07-06T01:00:00Z', status: 'failed' }],
        TODAY
      )
    ).toBe(false)
  })

  it('ignores yesterday even when the UTC date matches today', () => {
    // 2026-07-06T20:00Z = 2026-07-07 06:00 Brisbane — the NEXT AU day.
    expect(
      alreadySentToday(
        [{ created_at: '2026-07-06T20:00:00Z', status: 'sent' }],
        TODAY
      )
    ).toBe(false)
    // 2026-07-05T13:00Z = 2026-07-05 23:00 Brisbane — the PREVIOUS AU day.
    expect(
      alreadySentToday(
        [{ created_at: '2026-07-05T13:00:00Z', status: 'sent' }],
        TODAY
      )
    ).toBe(false)
  })
})

// ─── Recipient resolution ────────────────────────────────────────────────────

describe('primaryContactEmail', () => {
  it('picks the first contact BY NAME with an email', () => {
    expect(
      primaryContactEmail([
        { name: 'Zoe', email: 'zoe@example.com' },
        { name: 'Adam', email: 'adam@example.com' },
      ])
    ).toBe('adam@example.com')
  })

  it('skips contacts without an email', () => {
    expect(
      primaryContactEmail([
        { name: 'Adam', email: null },
        { name: 'Bec', email: '  ' },
        { name: 'Cal', email: 'cal@example.com' },
      ])
    ).toBe('cal@example.com')
  })

  it('returns null when nobody has an email', () => {
    expect(primaryContactEmail([{ name: 'Adam', email: null }])).toBe(null)
    expect(primaryContactEmail([])).toBe(null)
  })
})

describe('pickLiveLink', () => {
  const live = { id: 'a', token: 't-a', revoked_at: null, expires_at: null }
  const revoked = {
    id: 'b',
    token: 't-b',
    revoked_at: '2026-01-01T00:00:00Z',
    expires_at: null,
  }

  it('prefers the requested link when it is still live', () => {
    expect(pickLiveLink([revoked, live], 'a')?.id).toBe('a')
  })

  it('falls back to the first live link when the preferred one is dead', () => {
    expect(pickLiveLink([revoked, live], 'b')?.id).toBe('a')
  })

  it('returns null when no link is live', () => {
    expect(pickLiveLink([revoked])).toBe(null)
    expect(pickLiveLink([])).toBe(null)
  })
})

// ─── Digest lines ────────────────────────────────────────────────────────────

describe('digestLine', () => {
  const TODAY = '2026-07-06'

  it('formats an overdue item', () => {
    expect(
      digestLine(
        {
          siteName: 'Depot',
          clientId: 'c1',
          title: 'Asbestos register review',
          kind: 'asbestos_register',
          reviewDue: '2026-07-01',
        },
        TODAY
      )
    ).toBe(
      'Depot — Asbestos register review (Asbestos register): overdue since 01/07/2026'
    )
  })

  it('formats a due-soon item', () => {
    expect(
      digestLine(
        {
          siteName: 'Depot',
          clientId: 'c1',
          title: 'AMP review',
          kind: 'asbestos_mgmt_plan',
          reviewDue: '2026-07-20',
        },
        TODAY
      )
    ).toContain('due 20/07/2026')
  })
})

// ─── Customer satisfaction metric ────────────────────────────────────────────

describe('averageRating (customer_satisfaction_avg)', () => {
  it('averages ratings to 2 dp', () => {
    expect(averageRating([5, 4, 4])).toBe(4.33)
    expect(averageRating([1, 5])).toBe(3)
    expect(averageRating([4])).toBe(4)
  })

  it('an empty period is null — never a fake 0', () => {
    expect(averageRating([])).toBe(null)
  })

  it('ignores non-finite junk; all-junk is null', () => {
    expect(averageRating([NaN, 4, Infinity])).toBe(4)
    expect(averageRating([NaN])).toBe(null)
  })
})
