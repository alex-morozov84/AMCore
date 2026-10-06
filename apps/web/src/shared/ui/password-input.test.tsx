import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { PasswordInput } from './password-input'

describe('PasswordInput', () => {
  it('preserves the field, ref and value while toggling without submitting', () => {
    const submit = vi.fn(event => event.preventDefault())
    const ref = vi.fn()
    render(<form onSubmit={submit}><label htmlFor="password">Password</label>
      <PasswordInput id="password" ref={ref} defaultValue="example-password" autoComplete="current-password"
        showLabel="Show password" hideLabel="Hide password" />
    </form>)
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveValue('example-password')
    expect(input).toHaveAttribute('autocomplete', 'current-password')
    expect(ref).toHaveBeenCalledWith(input)
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
    expect(submit).not.toHaveBeenCalled()
  })

  it('disables both the input and its disclosure action', () => {
    render(<PasswordInput aria-label="Password" disabled showLabel="Show password" hideLabel="Hide password" />)
    expect(screen.getByLabelText('Password')).toBeDisabled()
    expect(screen.getByRole('button')).toBeDisabled()
  })
})
