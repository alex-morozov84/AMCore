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

  it('preserves a newer draft against its own earlier navigation committing, and still commits that draft', () => {
    const { rerender } = renderInput({ defaultValue: '' })
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: 'a' } })
    advance(300)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=a&sortBy=createdAt', {
      scroll: false,
    })
    replaceMock.mockClear()

    // A newer draft, typed before the "a" navigation's RSC response commits.
    fireEvent.change(input, { target: { value: 'ab' } })

    // The stale response for "a" arrives and re-renders this component with
    // its own last-navigated value — not a genuinely external change (e.g.
    // Back/Forward) — so the newer "ab" draft must survive it.
    rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{}}>
        <SearchInput
          baseHref="/en/admin/users"
          defaultValue="a"
          sortBy="createdAt"
          label="Search users"
          placeholder="Search by name or email"
          clearLabel="Clear search"
          inputId="users-search"
        />
      </NextIntlClientProvider>
    )
    expect(input).toHaveValue('ab')

    // The later debounce for "ab" (started when it was typed) still commits
    // — this isn't just a frozen, never-sent draft.
    advance(300)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=ab&sortBy=createdAt', {
      scroll: false,
    })
  })

  it('preserves a newer draft even when TWO of its own navigations are outstanding at once', () => {
    // Distinct from the test above: there, "ab"'s own navigation had not
    // been initiated yet when "a"'s stale response arrived. Here, both "a"
    // and "ab" have already been sent to the router (both debounces fired)
    // before either response commits — only recognizing the *latest*
    // self-navigated value, not every outstanding one, was a real gap an
    // earlier version of this fix had.
    const { rerender } = renderInput({ defaultValue: '' })
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: 'a' } })
    advance(300)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=a&sortBy=createdAt', {
      scroll: false,
    })

    fireEvent.change(input, { target: { value: 'ab' } })
    advance(300)
    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?search=ab&sortBy=createdAt', {
      scroll: false,
    })

    // "a"'s response finally commits — arriving *after* "ab" was already
    // sent, not before.
    rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{}}>
        <SearchInput
          baseHref="/en/admin/users"
          defaultValue="a"
          sortBy="createdAt"
          label="Search users"
          placeholder="Search by name or email"
          clearLabel="Clear search"
          inputId="users-search"
        />
      </NextIntlClientProvider>
    )
    expect(input).toHaveValue('ab')
    // The stale echo must not trigger a third, redundant navigation either.
    expect(replaceMock).toHaveBeenCalledTimes(2)
  })

  it('still resyncs to a genuinely external value even when a self-navigation is also pending', () => {
    const { rerender } = renderInput({ defaultValue: 'alice' })
    const input = screen.getByLabelText('Search users')
    expect(input).toHaveValue('alice')

    // An external change (e.g. Back/Forward) to a value this component
    // never itself navigated to.
    rerender(
      <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={{}}>
        <SearchInput
          baseHref="/en/admin/users"
          defaultValue="carol"
          sortBy="createdAt"
          label="Search users"
          placeholder="Search by name or email"
          clearLabel="Clear search"
          inputId="users-search"
        />
      </NextIntlClientProvider>
    )
    expect(input).toHaveValue('carol')
  })

  it('trims the committed search so the URL never carries a non-canonical whitespace-only value', () => {
    renderInput({ defaultValue: 'foo' })
    const input = screen.getByLabelText('Search users')

    fireEvent.change(input, { target: { value: '   ' } })
    advance(300)

    expect(replaceMock).toHaveBeenCalledWith('/en/admin/users?sortBy=createdAt', {
      scroll: false,
    })
  })

  it('caps the input at 255 characters, matching the backend schema', () => {
    renderInput()
    expect(screen.getByLabelText('Search users')).toHaveAttribute('maxlength', '255')
  })
})
