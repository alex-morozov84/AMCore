// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { proxyToBackend } from './authenticated-proxy'
import { makeRequest, mockCookieStore } from './authenticated-proxy.test-helpers'
import { ensureFreshSession } from './ensure-fresh-session'
import { isTrustedOrigin } from './origin-guard'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('./origin-guard', () => ({ isTrustedOrigin: vi.fn() }))
vi.mock('./ensure-fresh-session', () => ({ ensureFreshSession: vi.fn() }))
vi.mock('./upstream-refresh', () => ({ upstreamRefresh: vi.fn() }))

describe('proxy streaming remains transparent', () => {
  beforeEach(() => {
    mockCookieStore('sess-1')
    vi.mocked(isTrustedOrigin).mockReturnValue(true)
    vi.mocked(ensureFreshSession).mockResolvedValue({ accessToken: 'at-1' } as never)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('returns the first SSE chunk while upstream is still unfinished', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start: (c) => {
        writer = c
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(stream, {
          headers: { 'content-type': 'text/event-stream' },
        })
      )
    )
    const response = await proxyToBackend(makeRequest('events'), ['events'])
    const reader = response.body!.getReader()
    writer.enqueue(encoder.encode('data: first\n\n'))
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: first\n\n')
    writer.enqueue(encoder.encode('data: second\n\n'))
    writer.close()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: second\n\n')
    expect((await reader.read()).done).toBe(true)
  })

  it('keeps multipart stream identity, bytes and duplex without buffering', async () => {
    const bytes =
      '--fixture\r\nContent-Disposition: form-data; name="file"\r\n\r\nabc\r\n--fixture--\r\n'
    const request = makeRequest('uploads', {
      method: 'POST',
      body: bytes,
      headers: { 'content-type': 'multipart/form-data; boundary=fixture' },
    })
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await proxyToBackend(request, ['uploads'])
    const init = fetchMock.mock.calls[0][1] as RequestInit & { duplex: string }
    expect(init.body).toBe(request.body)
    expect(init.duplex).toBe('half')
    expect((init.headers as Headers).get('content-type')).toBe(
      'multipart/form-data; boundary=fixture'
    )
    expect(await new Response(init.body).text()).toBe(bytes)
  })
})
