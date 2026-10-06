// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { invitationBackend, InvitationBackendError } from './invitation-upstream'

vi.mock('server-only', () => ({}))
afterEach(() => vi.unstubAllGlobals())
const options = {
  method: 'POST' as const,
  expectedStatus: 201 as const,
  signal: new AbortController().signal,
  source: new Headers(),
}
const schema = z.strictObject({ status: z.literal('example') })

describe('invitation direct transport', () => {
  it('uses only code-owned authority and proof headers', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'example' }, { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    await invitationBackend('/auth/invites/continuations', schema, {
      ...options,
      credential: 'server-proof',
      handoff: { attemptId: 'server-attempt', cleanupKey: 'server-key' },
      source: new Headers({
        authorization: 'Bearer browser-secret',
        'x-invitation-continuation': 'browser-proof',
        'x-invitation-handoff-key': 'browser-key',
      }),
    })
    const headers = fetch.mock.calls[0]![1].headers as Headers
    expect(headers.get('x-invitation-continuation')).toBe('server-proof')
    expect(headers.get('x-invitation-handoff-key')).toBe('server-key')
    expect(headers.has('authorization')).toBe(false)
  })

  it('sends a genuinely empty POST for bodyless API operations', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'example' }, { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await invitationBackend('/auth/invites/continuations/context', schema, {
      ...options,
      expectedStatus: 200,
      credential: 'server-proof',
    })
    const init = fetch.mock.calls[0]![1] as RequestInit
    expect(init.body).toBeUndefined()
    expect(new Headers(init.headers).has('content-type')).toBe(false)
  })

  it.each([200, 202])(
    'treats unexpected successful status %s as unknown outcome',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(Response.json({ status: 'example' }, { status }))
      )
      await expect(
        invitationBackend('/auth/invites/continuations', schema, options)
      ).rejects.toMatchObject({
        status: 503,
        knownRejection: false,
        category: 'contract',
      })
    }
  )

  it('treats malformed successful acknowledgment as unknown instead of rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ token: 'fake-private-data' }, { status: 201 }))
    )
    await expect(
      invitationBackend('/auth/invites/continuations', schema, options)
    ).rejects.toMatchObject({
      status: 503,
      knownRejection: false,
      category: 'contract',
    })
  })

  it('keeps structured rejection and retry timing without retaining upstream body secrets', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            {
              errorCode: 'RATE_LIMIT_EXCEEDED',
              token: 'fake-private-data',
              message: 'fake-private-data',
            },
            { status: 429, headers: { 'retry-after': '8' } }
          )
        )
    )
    let caught: unknown
    try {
      await invitationBackend('/auth/invites/continuations', schema, options)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(InvitationBackendError)
    expect(caught).toMatchObject({
      knownRejection: true,
      retryAfterSeconds: 8,
      errorCode: 'RATE_LIMIT_EXCEEDED',
    })
    expect(JSON.stringify(caught)).not.toContain('fake-private-data')
  })

  it('captures the refresh cookie only in the server result envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          { status: 'example' },
          {
            status: 201,
            headers: { 'set-cookie': 'refresh_token=fake-refresh; HttpOnly; Path=/' },
          }
        )
      )
    )
    expect(await invitationBackend('/auth/invites/register', schema, options)).toEqual({
      data: { status: 'example' },
      refreshToken: 'fake-refresh',
    })
  })
})
