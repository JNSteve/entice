// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import * as React from 'react'
import { GstAmountInput } from '@/components/GstAmountInput'

afterEach(cleanup)

function Harness({ onChange }: { onChange: (v: number | null) => void }) {
  const [v, setV] = React.useState<number | null>(null)
  return (
    <GstAmountInput
      value={v}
      onChange={(x) => {
        setV(x)
        onChange(x)
      }}
      gstRate={10}
    />
  )
}

test('receipt total typed inc GST is stored ex GST; switching basis re-reads the figure', async () => {
  const onChange = vi.fn()
  const user = userEvent.setup()
  render(<Harness onChange={onChange} />)

  await user.type(screen.getByPlaceholderText('0.00'), '110')
  await user.tab()
  expect(onChange).toHaveBeenLastCalledWith(100)
  expect(screen.getByText(/Saved as \$100\.00 ex GST \(GST \$10\.00\)/)).toBeTruthy()

  await user.click(screen.getByRole('radio', { name: 'Ex GST' }))
  expect(onChange).toHaveBeenLastCalledWith(110)
})
