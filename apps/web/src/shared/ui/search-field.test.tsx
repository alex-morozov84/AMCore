import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SearchField } from './search-field'

describe('SearchField', () => {
  it('renders caller copy and forwards text changes', () => {
    const onValueChange = vi.fn()
    render(
      <SearchField
        id="catalog-search"
        name="query"
        value=""
        onValueChange={onValueChange}
        onClear={vi.fn()}
        label="Search catalogue"
        placeholder="Name or code"
        clearLabel="Clear catalogue search"
        maxLength={42}
      />
    )

    const input = screen.getByLabelText('Search catalogue')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('name', 'query')
    expect(input).toHaveAttribute('maxlength', '42')
    expect(input).toHaveAttribute('placeholder', 'Name or code')
    fireEvent.change(input, { target: { value: 'acme' } })
    expect(onValueChange).toHaveBeenCalledWith('acme')
  })

  it('clears through the caller and returns focus to the field', () => {
    const onClear = vi.fn()
    render(
      <SearchField
        id="catalog-search"
        name="query"
        value="acme"
        onValueChange={vi.fn()}
        onClear={onClear}
        label="Search catalogue"
        placeholder="Name or code"
        clearLabel="Clear catalogue search"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Clear catalogue search' }))
    expect(onClear).toHaveBeenCalledOnce()
    expect(screen.getByLabelText('Search catalogue')).toHaveFocus()
  })

  it('does not render a clear action for an empty value', () => {
    render(
      <SearchField
        id="catalog-search"
        name="query"
        value=""
        onValueChange={vi.fn()}
        onClear={vi.fn()}
        label="Search catalogue"
        placeholder="Name or code"
        clearLabel="Clear catalogue search"
      />
    )
    expect(screen.queryByRole('button', { name: 'Clear catalogue search' })).not.toBeInTheDocument()
  })
})
