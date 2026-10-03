// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { MEMBER_REQUEST_BYTES, MEMBER_RESPONSE_BYTES } from '@amcore/shared'

import { readContextJson } from './context-body-budget'

function body(bytes: number) {
  return JSON.stringify({ padding: 'a'.repeat(bytes - 14) })
}
describe('decoded streamed member byte budgets', () => {
  it.each([MEMBER_REQUEST_BYTES, MEMBER_RESPONSE_BYTES])(
    'accepts cap and rejects cap+1 without trusting headers: %i',
    async (cap) => {
      const exact = body(cap)
      expect(Buffer.byteLength(exact)).toBe(cap)
      const encoded = new TextEncoder().encode(exact)
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(encoded.slice(0, 5))
          c.enqueue(encoded.slice(5))
          c.close()
        },
      })
      expect(await readContextJson(stream, cap)).toHaveProperty('padding')
      const over = new Response(body(cap + 1), { headers: { 'Content-Length': '1' } })
      await expect(readContextJson(over.body, cap)).rejects.toMatchObject({
        status: 413,
        errorCode: 'PAYLOAD_TOO_LARGE',
      })
    }
  )
  it('rejects invalid JSON/UTF8 and cancels oversized stream', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(20))
      },
      cancel,
    })
    await expect(readContextJson(stream, 10)).rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce()
    await expect(readContextJson(new Response('bad').body, 10)).rejects.toMatchObject({
      status: 400,
    })
  })
})
