import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import { MfaCodeInput } from './mfa-code-input'

function CodeForm({
  method = 'totp',
  onSubmit,
}: {
  method?: 'totp' | 'recovery_code'
  onSubmit: (value: string) => void
}) {
  const [value, setValue] = useState('')
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
    >
      <MfaCodeInput
        aria-label="Verification code"
        method={method}
        value={value}
        onValueChange={setValue}
      />
      <button type="submit">Confirm</button>
    </form>
  )
}

it('accepts a whole spaced code with a leading zero and submits only on Enter', async () => {
  const user = userEvent.setup()
  const submit = vi.fn()
  render(<CodeForm onSubmit={submit} />)
  const input = screen.getByRole('textbox', { name: 'Verification code' })
  await user.click(input)
  await user.paste('012 345')
  expect(input).toHaveValue('012345')
  expect(submit).not.toHaveBeenCalled()
  await user.keyboard('{Enter}')
  expect(submit).toHaveBeenCalledOnce()
  expect(submit).toHaveBeenCalledWith('012345')
})

it('rejects non-digit typing and limits the app code to six characters without auto-submitting', async () => {
  const user = userEvent.setup()
  const submit = vi.fn()
  render(<CodeForm onSubmit={submit} />)
  const input = screen.getByRole('textbox', { name: 'Verification code' })
  await user.type(input, '0a1234567')
  expect(input).toHaveValue('012345')
  expect(input).toHaveAttribute('inputmode', 'numeric')
  expect(input).toHaveAttribute('autocomplete', 'one-time-code')
  expect(submit).not.toHaveBeenCalled()
})

it('preserves the complete backup code instead of applying the six-digit mask', async () => {
  const user = userEvent.setup()
  const submit = vi.fn()
  render(<CodeForm method="recovery_code" onSubmit={submit} />)
  const input = screen.getByRole('textbox', { name: 'Verification code' })
  const code = 'abcd-1234-abcd-1234-abcd-1234-abcd-1234'
  await user.click(input)
  await user.paste(code)
  expect(input).toHaveValue(code)
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  expect(submit).toHaveBeenCalledWith(code)
})
