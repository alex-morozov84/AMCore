import { DEFAULT_LOCALE } from '@amcore/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
  const client = new QueryClient()
  return render(
    <NextIntlClientProvider
      locale={DEFAULT_LOCALE}
      messages={{ console: { identityLookup: copy } }}
    >
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NextIntlClientProvider>
  )
}

describe('AuditLookup', () => {
  it('resets through the real kind adapter and sends only the selected ID', async () => {
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const { kind } = JSON.parse(String(init.body))
      return {
        ok: true,
        json: async () => ({
          kind,
          ...{
            items: [{ id: `${kind}-id`, name: `${kind} result` }],
            hasMore: false,
          },
        }),
      }
    })
    vi.stubGlobal('fetch', fetch)
    const selected = vi.fn()
    const client = new QueryClient()
    const view = (kind: 'user' | 'organization') => (
      <NextIntlClientProvider
        locale={DEFAULT_LOCALE}
        messages={{ console: { identityLookup: copy } }}
      >
        <QueryClientProvider client={client}>
          <AuditLookup kind={kind} copy={copy} onSelect={selected} />
        </QueryClientProvider>
      </NextIntlClientProvider>
    )
    const h = render(view('user'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await screen.findByText('user result')
    h.rerender(view('organization'))
    expect(screen.queryByText('user result')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ada' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    fireEvent.click(
      await screen.findByRole('button', { name: /Select record\s*:\s*organization result/ })
    )
    expect(selected).toHaveBeenCalledExactlyOnceWith('organization-id')
    expect(screen.queryByText('organization result')).not.toBeInTheDocument()
    expect(
      fetch.mock.calls.map(([url, init]) => [url.includes('Ada'), JSON.parse(String(init.body))])
    ).toEqual([
      [false, { kind: 'user', search: 'Ada' }],
      [false, { kind: 'organization', search: 'Ada' }],
    ])
  })

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
