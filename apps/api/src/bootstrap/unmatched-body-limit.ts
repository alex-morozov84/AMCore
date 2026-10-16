import { pipeline, type Readable, type Transform } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

import { HttpException } from '@nestjs/common'

import { decodedBodyLimit } from './decoded-body-limit.js'
import { REQUEST_BODY_LIMIT_BYTES } from './request-body-policy.js'

/** The native compression plugin adds route hooks; unmatched requests need their own decoded cap. */
export function unmatchedBodyLimit(payload: Readable, encoding?: string): Transform {
  encoding = encoding?.trim().toLowerCase()
  if (!encoding || encoding === 'identity')
    return decodedBodyLimit(payload, REQUEST_BODY_LIMIT_BYTES)
  const factories = { gzip: createGunzip, deflate: createInflate, br: createBrotliDecompress }
  const factory = Object.hasOwn(factories, encoding)
    ? factories[encoding as keyof typeof factories]
    : undefined
  if (!factory) throw new HttpException('Unsupported content encoding', 415)
  const decoder = factory()
  let encodedBytes = 0
  Object.defineProperty(decoder, 'receivedEncodedLength', { get: () => encodedBytes })
  const count = (chunk: Buffer): void => {
    encodedBytes += chunk.length
  }
  payload.on('data', count)
  decoder.on('error', () => bounded.destroy(new HttpException('Invalid compressed body', 400)))
  const bounded = decodedBodyLimit(decoder, REQUEST_BODY_LIMIT_BYTES)
  bounded.once('close', () => {
    payload.removeListener('data', count)
    decoder.destroy()
  })
  pipeline(payload, decoder, () => {
    /* Parser consumes the forwarded stream error. */
  })
  return bounded
}
