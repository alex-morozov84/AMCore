import type { Response } from 'express'
import type { FastifyReply } from 'fastify'

import { captureFastifyResponse } from './fastify-idempotency-response.js'
import { IDEMPOTENCY_REPLAY_HEADER } from './idempotency.constants.js'
import type { CompletedIdempotencyRecord } from './idempotency.types.js'

export type IdempotencyResponse = Response | FastifyReply

export function prepareReplayResponse(
  res: IdempotencyResponse,
  response: CompletedIdempotencyRecord
): string {
  for (const [name, value] of Object.entries(response.headers)) setHeader(res, name, value)
  setHeader(res, IDEMPOTENCY_REPLAY_HEADER, 'true')
  res.status(response.status)
  return response.body
}

export function wrapSend(res: IdempotencyResponse, onSend: (body: unknown) => Promise<void>): void {
  if ('raw' in res) {
    captureFastifyResponse(res, onSend)
    return
  }
  const original = res.send.bind(res)
  let active = true
  res.send = ((body: unknown) => {
    if (!active) return original(body)
    active = false
    void onSend(body).finally(() => original(body))
    return res
  }) as Response['send']
}

export function responseRecord(
  res: IdempotencyResponse,
  body: unknown
): CompletedIdempotencyRecord {
  return { status: res.statusCode, body: normalizeBody(body), headers: replayHeaders(res) }
}

function replayHeaders(res: IdempotencyResponse): Record<string, string> {
  const contentType = res.getHeader('content-type')
  return typeof contentType === 'string' ? { 'content-type': contentType } : {}
}

function setHeader(res: IdempotencyResponse, name: string, value: string): void {
  if ('raw' in res) res.header(name, value)
  else res.setHeader(name, value)
}

function normalizeBody(body: unknown): string {
  if (Buffer.isBuffer(body)) return body.toString('utf8')
  if (typeof body === 'string') return body
  if (body === undefined) return ''
  return JSON.stringify(body)
}
