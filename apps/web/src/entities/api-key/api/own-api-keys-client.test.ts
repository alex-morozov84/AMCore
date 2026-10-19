import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ownApiKeysClient } from './own-api-keys-client'

vi.mock('client-only', () => ({}))
const binding = 'a'.repeat(64)
const input = {
  name: 'Export',
  organizationId: 'cmp00000000000000000000000',
  scopes: ['read:Organization'],
}
const created = {
  ...input,
  id: 'key-a',
  key: '<fake-secret>',
  expiresAt: null,
  createdAt: '2026-10-19T00:00:00.000Z',
}
beforeEach(() => vi.restoreAllMocks())
describe('own-key browser transport', () => {
  it('omits cleared optional filters rather than sending a literal undefined', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ binding, data: { data: [], total: 0, page: 1, limit: 20 } })
      )
    await ownApiKeysClient.list(
      binding,
      {
        page: 1,
        limit: 20,
        status: 'all',
        search: 'Export',
        organizationId: undefined,
        organizationAvailability: undefined,
      },
      new AbortController().signal
    )
    const url = new URL(String(fetch.mock.calls[0]?.[0]), 'http://example.test')
    expect(url.searchParams.get('search')).toBe('Export')
    expect(url.searchParams.has('organizationId')).toBe(false)
    expect(url.searchParams.has('organizationAvailability')).toBe(false)
  })

  it('returns a strict result directly without any Query or Mutation client', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ binding, data: created }, { status: 201 }))
    expect(await ownApiKeysClient.create(binding, input, new AbortController().signal)).toEqual(
      created
    )
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      cache: 'no-store',
      headers: { 'X-AMCore-Context-Session': binding },
    })
  })
  it('never retains echoed secrets or raw error fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { errorCode: '<fake-secret>', message: '<fake-secret>', key: '<fake-secret>' },
        { status: 503, headers: { 'retry-after': '2' } }
      )
    )
    let error: unknown
    try {
      await ownApiKeysClient.create(binding, input, new AbortController().signal)
    } catch (failure) {
      error = failure
    }
    expect(JSON.stringify(error)).not.toContain('<fake-secret>')
    expect(error).toMatchObject({ status: 503, retryAfterSeconds: 2 })
  })
  it('retains session status even when an error body is malformed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('broken', { status: 401 }))
    await expect(
      ownApiKeysClient.verify(binding, new AbortController().signal)
    ).rejects.toMatchObject({ status: 401 })
  })
  it('discards an invalid 201 without exposing parser input in the error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ binding, data: { ...created, unknown: '<fake-secret>' } }, { status: 201 })
    )
    await expect(
      ownApiKeysClient.create(binding, input, new AbortController().signal)
    ).rejects.toEqual(new Error('INVALID_UPSTREAM_RESPONSE'))
  })
  it('rejects another binding and oversized session envelopes', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ binding: 'b'.repeat(64), data: { verified: true } }))
      .mockResolvedValueOnce(new Response('x'.repeat(2049)))
    await expect(
      ownApiKeysClient.verify(binding, new AbortController().signal)
    ).rejects.toMatchObject({ status: 409 })
    await expect(ownApiKeysClient.verify(binding, new AbortController().signal)).rejects.toEqual(
      new Error('INVALID_UPSTREAM_RESPONSE')
    )
  })
})
