// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { DocBlocksEditor } from '../src/components/DocBlocksEditor'
import type { DocBlock } from '../src/lib/quote-doc'

const BLOCKS: DocBlock[] = [
  { id: 'b1', type: 'bullets', heading: 'Exclusions', items: ['one', 'two'] },
  { id: 'p1', type: 'pricing', heading: 'Fee', note: 'Fixed.' },
  { id: 't1', type: 'table', heading: 'Terms', columns: ['Term', 'Detail'], rows: [{ label: 'Payment', value: '14 days' }] },
]

// Vitest globals are off in this repo, so RTL's auto-cleanup never registers.
afterEach(cleanup)

describe('DocBlocksEditor', () => {
  test('renders one card per block with heading inputs', () => {
    render(<DocBlocksEditor value={BLOCKS} onChange={() => {}} />)
    expect(screen.getByDisplayValue('Exclusions')).toBeTruthy()
    expect(screen.getByDisplayValue('Fee')).toBeTruthy()
    expect(screen.getByDisplayValue('Terms')).toBeTruthy()
  })

  test('editing the bullets textarea emits split items', () => {
    const onChange = vi.fn()
    render(<DocBlocksEditor value={BLOCKS} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Bullet items'), { target: { value: 'one\ntwo\nthree' } })
    expect(onChange).toHaveBeenCalledWith([{ ...BLOCKS[0], items: ['one', 'two', 'three'] }, BLOCKS[1], BLOCKS[2]])
  })

  test('editing a table cell emits the updated row', () => {
    const onChange = vi.fn()
    render(<DocBlocksEditor value={BLOCKS} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('14 days'), { target: { value: '30 days' } })
    expect(onChange.mock.calls[0][0][2]).toMatchObject({ rows: [{ label: 'Payment', value: '30 days' }] })
  })

  test('the pricing block has no delete button; others do; move down reorders', () => {
    const onChange = vi.fn()
    render(<DocBlocksEditor value={BLOCKS} onChange={onChange} />)
    expect(screen.getAllByLabelText('Delete block')).toHaveLength(2)
    fireEvent.click(screen.getAllByLabelText('Move down')[0])
    expect(onChange).toHaveBeenCalledWith([BLOCKS[1], BLOCKS[0], BLOCKS[2]])
  })
})
