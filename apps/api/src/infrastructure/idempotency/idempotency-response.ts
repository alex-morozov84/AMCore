import type { Response } from 'express'

import { IDEMPOTENCY_REPLAY_HEADER } from './idempotency.constants'
import type { CompletedIdempotencyRecord } from './idempotency.types'

export function prepareReplayResponse(res: Response, response: CompletedIdempotencyRecord): string {
  for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value)
  res.setHeader(IDEMPOTENCY_REPLAY_HEADER, 'true')
  res.status(response.status)
  return response.body
}

export function wrapSend(res: Response, onSend: (body: unknown) => Promise<void>): void {
  const original = res.send.bind(res)
  let active = true
  res.send = ((body: unknown) => {
    if (!active) return original(body)
    active = false
    void onSend(body).finally(() => original(body))
    return res
  }) as Response['send']
}

export function responseRecord(res: Response, body: unknown): CompletedIdempotencyRecord {
  return { status: res.statusCode, body: normalizeBody(body), headers: replayHeaders(res) }
}

function replayHeaders(res: Response): Record<string, string> {
  const contentType = res.getHeader('content-type')
  return typeof contentType === 'string' ? { 'content-type': contentType } : {}
}

function normalizeBody(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') return body
  if (body === undefined) return ''
  return JSON.stringify(body)
}
