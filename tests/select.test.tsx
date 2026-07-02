// @vitest-environment jsdom
//
// Regression test for the app-wide select-display bug: Base UI's
// `Select.Value` renders the RAW value (e.g. a uuid) in the closed trigger
// unless the root receives an `items` prop mapping values to labels. Our
// shared <Select> wrapper derives `items` from the authored <SelectItem>
// children so every call site shows the selected item's LABEL.
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const CLIENTS = [
  { id: '11450f03-f7a1-49f7-9296-ed48c8a809e1', name: 'Mermaid Beach Bowls Club' },
  { id: '0ebc70ca-e1f7-4360-813f-9f81c3b476c3', name: 'Astrec' },
]

function ClientSelect({
  value,
  clients = CLIENTS,
  onValueChange,
}: {
  value?: string | null
  clients?: { id: string; name: string }[]
  onValueChange?: (v: unknown) => void
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder="Pick a client…" />
      </SelectTrigger>
      <SelectContent>
        {clients.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

afterEach(cleanup)

describe('shared Select', () => {
  it('shows the selected item label in the trigger, not the raw id (controlled, pre-filled)', () => {
    render(<ClientSelect value={CLIENTS[0].id} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger.textContent).toContain('Mermaid Beach Bowls Club')
    expect(trigger.textContent).not.toContain(CLIENTS[0].id)
  })

  it('shows the placeholder when nothing is selected', () => {
    render(<ClientSelect value={null} />)
    expect(screen.getByRole("combobox").textContent).toContain('Pick a client…')
  })

  it('shows the label after selecting an item from the popup (uncontrolled)', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <Select onValueChange={onValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Pick a client…" />
        </SelectTrigger>
        <SelectContent>
          {CLIENTS.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
    const trigger = screen.getByRole('combobox')
    expect(trigger.textContent).toContain('Pick a client…')

    await user.click(trigger)
    const listbox = await screen.findByRole('listbox')
    await user.click(within(listbox).getByText('Astrec'))

    expect(onValueChange).toHaveBeenCalledWith(
      CLIENTS[1].id,
      expect.anything()
    )
    expect(trigger.textContent).toContain('Astrec')
    expect(trigger.textContent).not.toContain(CLIENTS[1].id)
  })

  it('resolves the label when options load after mount (dynamic lists)', () => {
    const { rerender } = render(
      <ClientSelect value={CLIENTS[1].id} clients={[]} />
    )
    // Options arrive on a later render (e.g. fetched after mount)
    rerender(<ClientSelect value={CLIENTS[1].id} clients={CLIENTS} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger.textContent).toContain('Astrec')
    expect(trigger.textContent).not.toContain(CLIENTS[1].id)
  })

  it('finds labels inside groups and keeps multiple selects independent', () => {
    render(
      <>
        <ClientSelect value={CLIENTS[0].id} />
        <Select value="opt-b" onValueChange={() => {}}>
          <SelectTrigger>
            <SelectValue placeholder="Pick…" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Group</SelectLabel>
              <SelectItem value="opt-a">Option A</SelectItem>
              <SelectItem value="opt-b">Option B</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </>
    )
    const triggers = screen.getAllByRole('combobox')
    expect(triggers[0].textContent).toContain('Mermaid Beach Bowls Club')
    expect(triggers[1].textContent).toContain('Option B')
    expect(triggers[1].textContent).not.toContain('opt-b')
  })
})
