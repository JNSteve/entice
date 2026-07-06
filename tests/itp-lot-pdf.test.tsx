import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { ItpPdf } from '../src/pdf/ItpPdf'
import { LotPdf } from '../src/pdf/LotPdf'

const company = {
  name: 'Test Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Brisbane QLD',
  phone: '07 3000 0000',
  email: 'office@test.example',
  logoUrl: undefined,
}

test('itp pdf renders (checklist, point types, statuses)', async () => {
  const buffer = await renderToBuffer(
    <ItpPdf
      itp={{
        number: 'ITP-0001',
        title: 'Bulk Earthworks & Subgrade — Rev A',
        activity: 'Bulk earthworks and subgrade preparation',
        status: 'Active',
        project: 'P-0001 — Riverbank Stabilisation',
        adoptedAt: '01/07/2026',
        adoptedBy: 'Alice Admin',
        lotCount: 2,
      }}
      company={company}
      items={[
        {
          position: 1,
          description: 'Proof roll subgrade',
          acceptance_criteria: 'No visible deflection under a loaded roller pass',
          spec_ref: 'AS 3798 §5.4',
          point_type: 'witness',
          record_required: true,
          responsible: 'Geotechnical engineer',
          status: 'passed',
          checked_by: 'Sam Super',
          checked_at: '03/07/2026',
        },
        {
          position: 2,
          description: 'Layer compaction testing',
          acceptance_criteria: 'Density ratio ≥ 95% Standard MDD',
          spec_ref: 'AS 1289 5.4.1',
          point_type: 'surveillance',
          record_required: true,
          responsible: 'NATA laboratory',
          status: 'failed',
          checked_by: 'Sam Super',
          checked_at: '04/07/2026',
        },
        {
          position: 3,
          description: 'Subgrade level conformance survey',
          acceptance_criteria: 'Within +10/−25 mm of design level',
          spec_ref: 'AS 3798',
          point_type: 'hold',
          record_required: true,
          responsible: 'Surveyor / Superintendent',
          status: 'pending',
          checked_by: null,
          checked_at: null,
        },
      ]}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})

test('lot pdf renders (verdict, inspections, tests, hold releases, NCR refs)', async () => {
  const buffer = await renderToBuffer(
    <LotPdf
      lot={{
        number: 'LOT-0001',
        description: 'Subgrade — northern car park, layer 2',
        location: 'Ch 0–120',
        project: 'P-0001 — Riverbank Stabilisation',
        itp: 'ITP-0001 — Bulk Earthworks & Subgrade — Rev A',
        status: 'closed',
        conformance: 'conforming',
        openedOn: '01/07/2026',
        closedAt: '05/07/2026',
        closedBy: 'Alice Admin',
        ncrNumbers: ['NCR-0012'],
        attachmentCount: 3,
      }}
      company={company}
      items={[
        {
          position: 1,
          description: 'Proof roll subgrade',
          acceptance_criteria: 'No visible deflection',
          spec_ref: 'AS 3798 §5.4',
          point_type: 'witness',
          item_status: 'passed',
          result: 'pass',
          inspected_by: 'Sam Super',
          inspected_at: '03/07/2026',
          ncr_number: null,
        },
        {
          position: 2,
          description: 'Layer compaction testing',
          acceptance_criteria: 'Density ratio ≥ 95% Standard MDD',
          spec_ref: 'AS 1289 5.4.1',
          point_type: 'surveillance',
          item_status: 'failed',
          result: 'fail',
          inspected_by: 'Sam Super',
          inspected_at: '04/07/2026',
          ncr_number: 'NCR-0012',
        },
        {
          position: 3,
          description: 'Imported fill certification',
          acceptance_criteria: 'VENM/ENM certified',
          spec_ref: null,
          point_type: 'surveillance',
          item_status: 'na',
          result: null,
          inspected_by: null,
          inspected_at: null,
          ncr_number: null,
        },
      ]}
      tests={[
        {
          test_type: 'Compaction',
          description: 'Density ratio — layer 2, ch 40',
          value: '96.5 % MDD',
          spec: '95 to —',
          pass: true,
          lab_ref: 'NATA 26-1187',
          tested_on: '04/07/2026',
          ncr_number: null,
        },
        {
          test_type: 'Compaction',
          description: 'Density ratio — layer 2, ch 80',
          value: '92 % MDD',
          spec: '95 to —',
          pass: false,
          lab_ref: 'NATA 26-1188',
          tested_on: '04/07/2026',
          ncr_number: 'NCR-0012',
        },
      ]}
      holdPoints={[
        {
          title: 'LOT-0001 — Subgrade level conformance survey',
          required_by: 'Surveyor / Superintendent',
          status: 'released',
          released_at: '05/07/2026',
          released_by: 'J. Smith — Superintendent',
          release_ref: 'HP-001-A',
        },
      ]}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})
