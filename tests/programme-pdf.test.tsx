import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { ProgrammePdf } from '../src/pdf/ProgrammePdf'

const company = {
  name: 'Test Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW',
  phone: '02 9000 0000',
  email: 'office@test.example',
  logoUrl: undefined,
}

test('programme pdf renders (landscape, bars, baseline, hold points, links)', async () => {
  const buffer = await renderToBuffer(
    <ProgrammePdf
      project={{ name: 'Riverbank Stabilisation', number: 'P-0001' }}
      company={company}
      printedDate="12/06/2026"
      baselineSet
      tasks={[
        {
          id: 'a',
          name: 'Site establishment',
          phase: 'Establishment',
          start: '2026-02-23',
          end: '2026-03-06',
          progressPct: 100,
          baselineStart: '2026-02-23',
          baselineEnd: '2026-03-06',
        },
        {
          id: 'b',
          name: 'Gabion walls',
          phase: 'Structures',
          start: '2026-05-18',
          end: '2026-06-19',
          progressPct: 40,
          baselineStart: '2026-05-11',
          baselineEnd: '2026-06-12',
        },
        {
          id: 'c',
          name: 'New task (no baseline)',
          phase: null,
          start: '2026-06-22',
          end: '2026-07-03',
          progressPct: 0,
          baselineStart: null,
          baselineEnd: null,
        },
      ]}
      links={[
        { predecessorId: 'a', successorId: 'b' },
        { predecessorId: 'b', successorId: 'c' },
      ]}
      holdPoints={[
        { taskId: 'b', title: 'Subgrade inspection', date: '2026-06-07', status: 'notified' },
        { taskId: 'c', title: 'Final inspection', date: '2026-07-01', status: 'pending' },
      ]}
    />
  )
  // %PDF magic bytes + non-trivial size
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})
