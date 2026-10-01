import { describe, expect, it } from 'vitest'
import {
  buildSwmsTitlePagePrefill,
  formatSiteAddress,
  formatWorkDates,
  parseTitlePage,
  type TitlePageSource,
} from '@/lib/swms-title-page'

const base: TitlePageSource = {
  parentRef: 'J-0042 — Asbestos removal',
  client: { name: 'Acme Builders', address: '9 Client Rd, Southport QLD 4215' },
  site: { address: '12 Site St', suburb: 'Burleigh Heads', state: 'QLD', postcode: '4220' },
  start: '2026-10-06',
  end: '2026-10-10',
  contacts: [],
}

describe('formatSiteAddress', () => {
  it('joins street and locality', () => {
    expect(formatSiteAddress(base.site)).toBe('12 Site St, Burleigh Heads QLD 4220')
  })
  it('skips blanks', () => {
    expect(formatSiteAddress({ address: null, suburb: 'Nerang', state: null, postcode: null })).toBe(
      'Nerang'
    )
    expect(formatSiteAddress(null)).toBe('')
  })
})

describe('formatWorkDates', () => {
  it('formats a range', () => {
    expect(formatWorkDates('2026-10-06', '2026-10-10')).toBe('6 Oct 2026 – 10 Oct 2026')
  })
  it('formats a single day once', () => {
    expect(formatWorkDates('2026-10-06', '2026-10-06')).toBe('6 Oct 2026')
  })
  it('handles open ends', () => {
    expect(formatWorkDates('2026-10-06', null)).toBe('From 6 Oct 2026')
    expect(formatWorkDates(null, '2026-10-10')).toBe('Until 10 Oct 2026')
    expect(formatWorkDates(null, null)).toBe('')
    expect(formatWorkDates('garbage', null)).toBe('')
  })
})

describe('buildSwmsTitlePagePrefill', () => {
  it('fills from the job, client and site', () => {
    const { values, contactId } = buildSwmsTitlePagePrefill(base)
    expect(values).toEqual({
      client_name: 'Acme Builders',
      principal_contractor: 'Acme Builders',
      job_ref: 'J-0042 — Asbestos removal',
      site_address: '12 Site St, Burleigh Heads QLD 4220',
      work_dates: '6 Oct 2026 – 10 Oct 2026',
      contact_name: '',
      contact_phone: '',
      contact_email: '',
    })
    expect(contactId).toBeNull()
  })

  it('falls back to the client address when there is no site', () => {
    const { values } = buildSwmsTitlePagePrefill({ ...base, site: null })
    expect(values.site_address).toBe('9 Client Rd, Southport QLD 4215')
  })

  it('leaves the site address blank when neither exists', () => {
    const { values } = buildSwmsTitlePagePrefill({
      ...base,
      site: null,
      client: { name: 'Acme', address: null },
    })
    expect(values.site_address).toBe('')
  })

  it('auto-picks the only contact', () => {
    const { values, contactId } = buildSwmsTitlePagePrefill({
      ...base,
      contacts: [{ id: 'c1', name: 'Pat Lee', role: 'PM', phone: '0400 000 000', email: null }],
    })
    expect(contactId).toBe('c1')
    expect(values.contact_name).toBe('Pat Lee')
    expect(values.contact_phone).toBe('0400 000 000')
    expect(values.contact_email).toBe('')
  })

  it('does not pick when there are several contacts', () => {
    const contacts = [
      { id: 'c1', name: 'Pat Lee', role: null, phone: null, email: null },
      { id: 'c2', name: 'Sam Fox', role: null, phone: null, email: null },
    ]
    const prefill = buildSwmsTitlePagePrefill({ ...base, contacts })
    expect(prefill.contactId).toBeNull()
    expect(prefill.values.contact_name).toBe('')
    expect(prefill.contacts).toHaveLength(2)
  })

  it('copes with no client', () => {
    const { values } = buildSwmsTitlePagePrefill({ ...base, client: null, site: null })
    expect(values.client_name).toBe('')
    expect(values.principal_contractor).toBe('')
  })
})

describe('parseTitlePage', () => {
  it('returns null for missing, invalid or blank values', () => {
    expect(parseTitlePage(null)).toBeNull()
    expect(parseTitlePage('nope')).toBeNull()
    expect(parseTitlePage({ client_name: '  ' })).toBeNull()
  })
  it('fills missing keys with blanks', () => {
    const parsed = parseTitlePage({ client_name: 'Acme' })
    expect(parsed?.client_name).toBe('Acme')
    expect(parsed?.site_address).toBe('')
  })
})
