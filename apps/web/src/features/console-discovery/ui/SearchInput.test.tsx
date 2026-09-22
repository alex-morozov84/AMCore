import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const replaceMock = vi.fn()
vi.mock('@/shared/lib/route-progress/use-route-progress-router', () => ({
  useRouteProgressRouter: () => ({ replace: replaceMock }),
}))

import { SearchInput } from './SearchInput'

function renderInput(props: Partial<React.ComponentProps<typeof SearchInput>> = {}) {
  return render(
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{}}>
      <SearchInput
        baseHref="/en/admin/users"
        defaultValue=""
        sortBy="createdAt"
        label="Search users"
        placeholder="Search by name or email"
        clearLabel="Clear search"
        inputId="users-search"
        {...props}
      />
    </NextIntlClientProvider>
  )
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  replaceMock.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SearchInput', () => {
  it('does not navigate on mount', () => {
    renderInput()
    advance(1000)
    expect(replaceMock).not.toHaveBeenCalled()
  })

  it('navigates with the debounced search value after 300ms of no typing', () => {
    renderInput()
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: 'alice' } })
    expect(replaceMock).not.toHaveBeenCalled()

    advance(299)
    expect(replaceMock).not.toHaveBeenCalled()

    advance(1)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=alice&sortBy=createdAt', {
      scroll: false,
    })
  })

  it('does not fire a redundant navigation for the same value twice', () => {
    renderInput()
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: 'alice' } })
    advance(300)
    expect(replaceMock).toHaveBeenCalledTimes(1)

    // Typing then deleting back to the same committed value must not
    // re-navigate to an identical URL.
    fireEvent.change(input, { target: { value: 'alice!' } })
    fireEvent.change(input, { target: { value: 'alice' } })
    advance(300)
    expect(replaceMock).toHaveBeenCalledTimes(1)
  })

  it('only commits the final value on rapid typing, not each intermediate keystroke', () => {
    renderInput()
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: 'a' } })
    advance(100)
    fireEvent.change(input, { target: { value: 'al' } })
    advance(100)
    fireEvent.change(input, { target: { value: 'ali' } })
    advance(300)

    expect(replaceMock).toHaveBeenCalledTimes(1)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=ali&sortBy=createdAt', {
      scroll: false,
    })
  })

  it('navigates immediately on submit, without waiting for the debounce', () => {
    renderInput()
    const input = screen.getByLabelText('Search users')
    fireEvent.change(input, { target: { value: 'bob' } })

    act(() => {
      fireEvent.submit(input.closest('form')!)
    })

    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=bob&sortBy=createdAt', {
      scroll: false,
    })
  })

  it('shows a clear button once there is a value, and clears immediately on click', () => {
    renderInput({ defaultValue: 'bob' })
    const clearButton = screen.getByRole('button', { name: 'Clear search' })

    act(() => {
      fireEvent.click(clearButton)
    })

    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?sortBy=createdAt', {
      scroll: false,
    })
  })

  it('returns focus to the input after clearing, since the clear button itself unmounts', () => {
    renderInput({ defaultValue: 'bob' })
    const input = screen.getByLabelText('Search users')
    const clearButton = screen.getByRole('button', { name: 'Clear search' })

    act(() => {
      fireEvent.click(clearButton)
    })

    expect(input).toHaveFocus()
  })

  it('uses type="text", not "search" — the browser adds its own clear affordance for the latter, duplicating ours', () => {
    renderInput({ defaultValue: 'bob' })
    expect(screen.getByLabelText('Search users')).toHaveAttribute('type', 'text')
  })

  it('renders no clear button when the search is empty', () => {
    renderInput({ defaultValue: '' })
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument()
  })

  it('preserves the current sortBy/sortOrder on a search navigation', () => {
    renderInput({ sortBy: 'name', sortOrder: 'desc' })
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: 'zed' } })
    advance(300)

    expect(replaceMock).toHaveBeenCalledWith(
      '/en/admin/users?search=zed&sortBy=name&sortOrder=desc',
      { scroll: false }
    )
  })

  it('resyncs the local draft when defaultValue changes externally (e.g. Back/Forward)', () => {
    const { rerender } = renderInput({ defaultValue: 'alice' })
    expect(screen.getByLabelText('Search users')).toHaveValue('alice')

    rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{}}>
        <SearchInput
          baseHref="/en/admin/users"
          defaultValue="bob"
          sortBy="createdAt"
          label="Search users"
          placeholder="Search by name or email"
          clearLabel="Clear search"
          inputId="users-search"
        />
      </NextIntlClientProvider>
    )

    expect(screen.getByLabelText('Search users')).toHaveValue('bob')
    // Resyncing from a prop change must not itself trigger a navigation.
    advance(300)
    expect(replaceMock).not.toHaveBeenCalled()
  })
})
