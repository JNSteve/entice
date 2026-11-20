import { describe, expect, it } from 'vitest'
import {
  groupLiveWork,
  isLiveWork,
  parseWorkKind,
  searchLiveWork,
  workHref,
  workKey,
  workTabs,
  type LiveWorkRow,
} from '@/lib/live-work'

const row = (over: Partial<LiveWorkRow>): LiveWorkRow => ({
  kind: 'job',
  id: 'a',
  number: 'RJ26001',
  title: 'Eaves removal',
  status: 'in_progress',
  client: 'Acme Strata',
  site: 'Depot, Tomago',
  ...over,
})

describe('isLiveWork', () => {
  it('jobs are live from scheduled through completed', () => {
    for (const s of ['scheduled', 'in_progress', 'completed']) {
      expect(isLiveWork('job', s, false)).toBe(true)
    }
  })

  it('jobs are not live before acceptance or after invoicing', () => {
    for (const s of ['quote', 'lost', 'invoiced', 'paid']) {
      expect(isLiveWork('job', s, false)).toBe(false)
    }
  })

  it('projects are live until closed', () => {
    for (const s of ['active', 'practical_completion', 'defects_liability']) {
      expect(isLiveWork('project', s, false)).toBe(true)
    }
    expect(isLiveWork('project', 'closed', false)).toBe(false)
  })

  it('archived work is never live', () => {
    expect(isLiveWork('job', 'in_progress', true)).toBe(false)
    expect(isLiveWork('project', 'active', true)).toBe(false)
  })

  it('a job status is not valid for a project', () => {
    expect(isLiveWork('project', 'in_progress', false)).toBe(false)
  })
})

describe('parseWorkKind', () => {
  it('accepts only job and project', () => {
    expect(parseWorkKind('job')).toBe('job')
    expect(parseWorkKind('project')).toBe('project')
    expect(parseWorkKind('quote')).toBeNull()
    expect(parseWorkKind(undefined)).toBeNull()
  })
})

describe('workHref and workTabs', () => {
  it('builds the job screen address, with and without a tab', () => {
    expect(workHref('job', 'abc')).toBe('/field/work/job/abc')
    expect(workHref('project', 'abc', 'day')).toBe('/field/work/project/abc/day')
  })

  it('projects get a Diary tab and jobs do not', () => {
    expect(workTabs('project').map((t) => t.tab)).toEqual([
      '', 'prestart', 'swms', 'day', 'diary', 'photos', 'docs',
    ])
    expect(workTabs('job').map((t) => t.tab)).toEqual([
      '', 'prestart', 'swms', 'day', 'photos', 'docs',
    ])
  })
})

describe('groupLiveWork', () => {
  const rows = [
    row({ id: 'j1', number: 'RJ26001' }),
    row({ id: 'j2', number: 'RJ26010', status: 'completed' }),
    row({ id: 'j3', number: 'RJ26005', status: 'scheduled' }),
    row({ kind: 'project', id: 'p1', number: 'RP26020', status: 'active' }),
  ]

  it('puts scheduled work first, finished jobs last, the rest in the middle', () => {
    const g = groupLiveWork(rows, new Set([workKey('job', 'j3')]))
    expect(g.scheduled.map((r) => r.id)).toEqual(['j3'])
    expect(g.live.map((r) => r.id)).toEqual(['p1', 'j1'])
    expect(g.finished.map((r) => r.id)).toEqual(['j2'])
  })

  it('a finished job that is scheduled today stays in the scheduled group', () => {
    const g = groupLiveWork(rows, new Set([workKey('job', 'j2')]))
    expect(g.scheduled.map((r) => r.id)).toEqual(['j2'])
    expect(g.finished).toEqual([])
  })

  it('a job and a project sharing an id are not confused', () => {
    const shared = [row({ id: 'x' }), row({ kind: 'project', id: 'x', status: 'active' })]
    const g = groupLiveWork(shared, new Set([workKey('project', 'x')]))
    expect(g.scheduled.map((r) => r.kind)).toEqual(['project'])
    expect(g.live.map((r) => r.kind)).toEqual(['job'])
  })

  it('sorts each group newest number first', () => {
    const g = groupLiveWork(rows, new Set())
    expect(g.live.map((r) => r.number)).toEqual(['RP26020', 'RJ26005', 'RJ26001'])
  })
})

describe('searchLiveWork', () => {
  const rows = [
    row({ id: 'j1', number: 'RJ26001', title: 'Eaves removal', client: 'Acme Strata', site: 'Depot, Tomago' }),
    row({ id: 'j2', number: 'RJ26002', title: 'Vinyl floor strip', client: null, site: null }),
  ]

  it('returns everything for a blank query', () => {
    expect(searchLiveWork(rows, '   ')).toHaveLength(2)
  })

  it('matches number, title, client and site, ignoring case', () => {
    expect(searchLiveWork(rows, 'rj26002').map((r) => r.id)).toEqual(['j2'])
    expect(searchLiveWork(rows, 'EAVES').map((r) => r.id)).toEqual(['j1'])
    expect(searchLiveWork(rows, 'acme').map((r) => r.id)).toEqual(['j1'])
    expect(searchLiveWork(rows, 'tomago').map((r) => r.id)).toEqual(['j1'])
  })

  it('matches the street address even though the row does not show it', () => {
    const withAddress = [row({ id: 'j9', address: '14 Smith St' }), ...rows]
    expect(searchLiveWork(withAddress, 'smith st').map((r) => r.id)).toEqual(['j9'])
  })

  it('copes with a missing client and site', () => {
    expect(searchLiveWork(rows, 'strata').map((r) => r.id)).toEqual(['j1'])
  })
})
