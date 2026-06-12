import { expect, test } from 'vitest'
import { renderToBuffer } from '@react-pdf/renderer'
import { FormPdf } from '../src/pdf/FormPdf'

const company = {
  name: 'Entice Civil Pty Ltd',
  abn: '11 222 333 444',
  address: '1 Test St, Sydney NSW 2000',
  phone: '02 9000 0000',
  email: 'office@entice.example',
  logoUrl: undefined,
}

const toolboxSchema = [
  { key: 'topic', label: 'Topic', type: 'text' as const, options: [], required: true },
  { key: 'discussion', label: 'Discussion points', type: 'textarea' as const, options: [], required: true },
  { key: 'matters_raised', label: 'Matters raised by crew', type: 'textarea' as const, options: [], required: false },
  { key: 'conducted_by', label: 'Conducted by', type: 'text' as const, options: [], required: true },
]

const toolboxData = {
  topic: 'Working at Heights — Scaffold Inspection & Edge Protection',
  discussion: 'Reviewed scaffold inspection checklist with crew. All edge protection must be in place before starting work at heights.',
  matters_raised: 'Two crew members requested updated harness sizing.',
  conducted_by: 'Entice Admin',
}

test('form pdf renders toolbox talk with signons (%PDF magic, non-trivial size)', async () => {
  const buffer = await renderToBuffer(
    <FormPdf
      submission={{
        templateName: 'Toolbox Talk',
        kind: 'toolbox',
        templateVersion: 1,
        submittedAt: '2026-06-12T07:30:00+10:00',
        submittedBy: 'Entice Admin',
        target: 'P-0001 — Riverbank Stabilisation Stage 2',
        plant: null,
        attachmentCount: 0,
      }}
      company={company}
      schema={toolboxSchema}
      data={toolboxData}
      signons={[
        {
          name: 'Entice Admin',
          company: 'Entice Civil Pty Ltd',
          internal: true,
          signedAt: '12/06/2026 07:32',
          imageUrl: null,
        },
        {
          name: 'James Bridger',
          company: 'Bridger Scaffolding Pty Ltd',
          internal: false,
          signedAt: '12/06/2026 07:35',
          imageUrl: null,
        },
      ]}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})

test('form pdf handles schema drift (extra data keys rendered under Other recorded fields)', async () => {
  const buffer = await renderToBuffer(
    <FormPdf
      submission={{
        templateName: 'Toolbox Talk',
        kind: 'toolbox',
        templateVersion: 1,
        submittedAt: '2026-06-12T09:00:00+10:00',
        submittedBy: 'Test User',
        target: 'P-0001 — Riverbank Stabilisation Stage 2',
        plant: null,
        attachmentCount: 2,
      }}
      company={company}
      schema={toolboxSchema}
      data={{
        ...toolboxData,
        legacy_field: 'This key was in v0 but not in current schema',
      }}
      signons={[]}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})

test('form pdf renders various field types (checkbox, rating, empty values)', async () => {
  const buffer = await renderToBuffer(
    <FormPdf
      submission={{
        templateName: 'Take 5 — Personal Risk Assessment',
        kind: 'take5',
        templateVersion: 1,
        submittedAt: '2026-06-12T10:00:00+10:00',
        submittedBy: 'Test Worker',
        target: 'P-0001 — Riverbank Stabilisation Stage 2',
        plant: null,
        attachmentCount: 0,
      }}
      company={company}
      schema={[
        { key: 'stop_think', label: 'Stop & think through the task', type: 'checkbox' as const, options: [], required: true },
        { key: 'hazard_rating', label: 'Hazard severity', type: 'rating' as const, options: [], required: false },
        { key: 'hazards_identified', label: 'Hazards identified', type: 'textarea' as const, options: [], required: false },
        { key: 'ppe_checked', label: 'PPE checked & worn', type: 'checkbox' as const, options: [], required: true },
      ]}
      data={{
        stop_think: true,
        hazard_rating: 3,
        hazards_identified: '',
        ppe_checked: false,
      }}
      signons={[]}
    />
  )
  expect(buffer.subarray(0, 4).toString()).toBe('%PDF')
  expect(buffer.length).toBeGreaterThan(1000)
})
