import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AuditCopy } from './audit-copy'
import { AuditLookup } from './AuditLookup'

const copy = {
  lookupUser: 'Search user',
  lookupOrganization: 'Search organization',
  lookupSearch: 'At least 2 characters',
  lookupEmpty: 'Nothing found',
  lookupSelect: 'Select record',
  lookupRefine: 'Refine search',
  lookupError: 'Search unavailable',
  loading: 'Loading',
} satisfies Pick<AuditCopy, 'lookupUser' | 'lookupOrganization'> & Record<string, string>

afterEach(() => vi.unstubAllGlobals())

function renderLookup(children: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ console: { identityLookup: copy } }}>
      {children}
    </NextIntlClientProvider>
  )
}

describe('AuditLookup', () => {
  it('runs Enter as an explicit lookup without submitting surrounding filters', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'user', items: [{ id: 'user-1', name: 'Ada' }], hasMore: false }),
    })
    vi.stubGlobal('fetch', fetch)
    const submit = vi.fn()
    renderLookup(
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

  it('shows a persistent empty result and does not repeat a completed lookup on Enter', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'user', items: [], hasMore: false }),
    })
    vi.stubGlobal('fetch', fetch)
    renderLookup(<AuditLookup kind="user" copy={copy} onSelect={() => undefined} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Search user' }), {
      target: { value: 'Ada' },
    })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Nothing found')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Find' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search user' }), { key: 'Enter' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('ignores an old response after a new query completes', async () => {
    let resolveOld!: (value: unknown) => void
    const oldResponse = new Promise((resolve) => {
      resolveOld = resolve
    })
    const response = (items: Array<{ id: string; name: string }>) => ({
      ok: true,
      json: async () => ({ kind: 'user', items, hasMore: false }),
    })
    const fetch = vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValueOnce(response([]))
    vi.stubGlobal('fetch', fetch)
    renderLookup(<AuditLookup kind="user" copy={copy} onSelect={() => undefined} />)
    const input = screen.getByRole('textbox', { name: 'Search user' })
    fireEvent.change(input, { target: { value: 'Ada' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.change(input, { target: { value: 'Nobody' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Nothing found')).toBeInTheDocument())
    await act(async () => {
      resolveOld(response([{ id: 'old', name: 'Ada' }]))
    })
    expect(screen.queryByText('Ada')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing found')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.queryByText('Nothing found')).not.toBeInTheDocument()
  })
})
import type { ReactNode } from 'react'
import { NextIntlClientProvider } from 'next-intl'
