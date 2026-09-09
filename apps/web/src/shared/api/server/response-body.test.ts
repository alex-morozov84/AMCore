import { describe, expect, it, vi } from 'vitest'

import { readJsonBody } from './response-body'

const neverCancelled = () => false
const alwaysCancelled = () => true

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

function responseWithFailingBody(error: unknown): Response {
  const response = new Response('{}', { status: 200 })
  vi.spyOn(response, 'json').mockRejectedValue(error)
  return response
}

describe('readJsonBody', () => {
  it('returns the parsed body on success', async () => {
    const result = await readJsonBody(jsonResponse({ id: 'p1' }), neverCancelled)
    expect(result).toEqual({ ok: true, body: { id: 'p1' } })
  })

  it('classifies a body-stream network failure (TypeError) as unavailable(network)', async () => {
    const result = await readJsonBody(
      responseWithFailingBody(new TypeError('terminated')),
      neverCancelled
    )
    expect(result).toEqual({ ok: false, reason: 'network' })
  })

  it('classifies a body-stream timeout (AbortError, not caller-cancelled) as unavailable(timeout)', async () => {
    const error = new DOMException('deadline exceeded', 'TimeoutError')
    const result = await readJsonBody(responseWithFailingBody(error), neverCancelled)
    expect(result).toEqual({ ok: false, reason: 'timeout' })
  })

  it('rethrows when the caller itself cancelled, even if the error looks like a timeout', async () => {
    const error = new DOMException('deadline exceeded', 'TimeoutError')
    await expect(readJsonBody(responseWithFailingBody(error), alwaysCancelled)).rejects.toBe(error)
  })

  it('treats a genuine SyntaxError (malformed JSON) as a valid-but-empty body, not a transport failure', async () => {
    const result = await readJsonBody(
      responseWithFailingBody(new SyntaxError('Unexpected token')),
      neverCancelled
    )
    expect(result).toEqual({ ok: true, body: undefined })
  })

  it('rethrows a genuinely unrecognized error instead of absorbing it', async () => {
    const error = new Error('a genuine bug')
    await expect(readJsonBody(responseWithFailingBody(error), neverCancelled)).rejects.toThrow(
      'a genuine bug'
    )
  })
})
