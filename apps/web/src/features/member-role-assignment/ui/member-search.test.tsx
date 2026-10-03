import { useState } from 'react'
import { NextIntlClientProvider } from 'next-intl'
import { DEFAULT_LOCALE } from '@amcore/shared'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const messages = { organizationMembers: { search: 'Search', clear: 'Clear search' } }

import { MemberSearch } from './member-search'

function Harness({ identity, commit }: { identity: string; commit: (v: string) => void }) {
  const [q, setQ] = useState({ search: '', page: 2 })
  return (
    <NextIntlClientProvider locale={DEFAULT_LOCALE} messages={messages}>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          throw new Error('search must not Save')
        }}
      >
        <MemberSearch
          id="search"
          identity={identity}
          {...q}
          onCommit={(search) => {
            commit(search)
            setQ({ search, page: 1 })
          }}
        />
      </form>
    </NextIntlClientProvider>
  )
}
afterEach(() => vi.useRealTimers())
describe('300ms identity-aware member search', () => {
  it('debounces rapid input, immediate Enter/Clear, no Save or duplicate commit', async () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    render(<Harness identity="binding/org/member" commit={commit} />)
    const input = screen.getByRole('textbox', { name: 'Search' })
    fireEvent.change(input, { target: { value: 'a' } })
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(commit).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: 'ab' } })
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(commit).toHaveBeenLastCalledWith('ab')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(commit).toHaveBeenLastCalledWith('abc')
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(commit).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(commit).toHaveBeenLastCalledWith('')
    expect(input).toHaveFocus()
  })
  it('same text in another identity retires draft and unmount cancels timers', async () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const view = render(<Harness identity="b/org1" commit={commit} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'old' } })
    view.rerender(<Harness identity="b/org2" commit={commit} />)
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(commit).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'late' } })
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(300))
    expect(commit).not.toHaveBeenCalled()
  })
})
