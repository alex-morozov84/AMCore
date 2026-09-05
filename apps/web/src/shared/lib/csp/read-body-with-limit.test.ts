// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

import { readBodyWithLimit } from './read-body-with-limit'

vi.mock('server-only', () => ({}))

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/csp-report', { method: 'POST', body, headers })
}

describe('readBodyWithLimit', () => {
  it('returns the body text when under the limit', async () => {
    const request = makeRequest('{"hello":"world"}')
    expect(await readBodyWithLimit(request, 1024)).toBe('{"hello":"world"}')
  })

  it('rejects via Content-Length before reading, when present and too large', async () => {
    const request = makeRequest('short body', { 'content-length': '999999' })
    expect(await readBodyWithLimit(request, 1024)).toBeNull()
  })

  it('rejects based on actual bytes read, even without a Content-Length header', async () => {
    // fetch's Request auto-computes Content-Length for a plain string body,
    // so simulate the "no/lying header" case with a stream body instead —
    // exactly the scenario this defense targets.
    const oversized = 'x'.repeat(2048)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized))
        controller.close()
      },
    })
    const request = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    expect(await readBodyWithLimit(request, 1024)).toBeNull()
  })

  it('handles a multi-byte UTF-8 character split across chunk boundaries', async () => {
    const text = 'a'.repeat(10) + '€' + 'b'.repeat(10)
    const bytes = new TextEncoder().encode(text)
    // Split mid-way through the 3-byte euro sign to prove streaming decode
    // doesn't corrupt it.
    const splitPoint = 11
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, splitPoint))
        controller.enqueue(bytes.slice(splitPoint))
        controller.close()
      },
    })
    const request = new Request('http://localhost/api/csp-report', {
      method: 'POST',
      body: stream,
      duplex: 'half',
    } as RequestInit)

    expect(await readBodyWithLimit(request, 1024)).toBe(text)
  })
})
