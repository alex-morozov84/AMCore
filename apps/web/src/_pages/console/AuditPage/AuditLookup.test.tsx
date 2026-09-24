import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuditCopy } from './audit-copy'
import { AuditLookup } from './AuditLookup'

const copy = {
  lookupUser: 'Search user',
  lookupSearch: 'At least 2 characters',
  lookupSubmit: 'Find',
  lookupSelect: 'Select record',
  lookupRefine: 'Refine search',
  lookupError: 'Search unavailable',
  loading: 'Loading',
} as AuditCopy

afterEach(() => vi.unstubAllGlobals())

describe('AuditLookup', () => {
  it('runs Enter as an explicit lookup without submitting surrounding filters', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'user', items: [{ id: 'user-1', name: 'Ada' }], hasMore: false }),
    })
    vi.stubGlobal('fetch', fetch)
    const submit = vi.fn()
    render(
      <form onSubmit={submit}>
        <AuditLookup kind="user" copy={copy} onSelect={() => undefined} />
      </form>
    )
    const input = screen.getByRole('textbox', { name: 'Search user' })
    fireEvent.change(input, { target: { value: 'Ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Ada')).toBeInTheDocument())
    expect(submit).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not repeat a completed debounced lookup when Find is clicked', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'user', items: [], hasMore: false }),
    })
    vi.stubGlobal('fetch', fetch)
    render(<AuditLookup kind="user" copy={copy} onSelect={() => undefined} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search user' }), {
      target: { value: 'Ada' },
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Find' }))
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
