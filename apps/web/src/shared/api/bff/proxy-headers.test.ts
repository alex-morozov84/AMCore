// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  AMCORE_CLIENT_IP_HEADER,
  forwardRequestHeaders,
  forwardResponseHeaders,
} from './proxy-headers'

describe('forwardRequestHeaders', () => {
  it('strips host/connection/cookie/content-length and sets the bearer token', () => {
    const source = new Headers({
      host: 'next.internal',
      connection: 'keep-alive',
      cookie: 'amcore_session=sess-1',
      'content-length': '42',
      'content-type': 'application/json',
      'accept-language': 'ru-RU',
      'idempotency-key': 'abc-123',
    })

    const forwarded = forwardRequestHeaders(source, 'at-1')

    expect(forwarded.has('host')).toBe(false)
    expect(forwarded.has('connection')).toBe(false)
    expect(forwarded.has('cookie')).toBe(false)
    expect(forwarded.has('content-length')).toBe(false)
    expect(forwarded.get('content-type')).toBe('application/json')
    expect(forwarded.get('accept-language')).toBe('ru-RU')
    expect(forwarded.get('idempotency-key')).toBe('abc-123')
    expect(forwarded.get('authorization')).toBe('Bearer at-1')
  })

  it('overrides a client-supplied Authorization header with the vault-derived one', () => {
    const source = new Headers({ authorization: 'Bearer client-supplied' })
    const forwarded = forwardRequestHeaders(source, 'at-1')
    expect(forwarded.get('authorization')).toBe('Bearer at-1')
  })

  it('strips Origin/Referer — the CSRF boundary is browser<->Next, not Next<->apps/api', () => {
    const source = new Headers({
      origin: 'http://localhost:3002',
      referer: 'http://localhost:3002/dashboard',
    })

    const forwarded = forwardRequestHeaders(source, 'at-1')

    expect(forwarded.has('origin')).toBe(false)
    expect(forwarded.has('referer')).toBe(false)
  })

  it('strips every forwarded/client-IP lookalike a browser could set — ADR-072', () => {
    const source = new Headers({
      forwarded: 'for=1.2.3.4',
      'x-forwarded-for': '1.2.3.4',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
      'x-real-ip': '1.2.3.4',
      'x-client-ip': '1.2.3.4',
      'client-ip': '1.2.3.4',
      'true-client-ip': '1.2.3.4',
      'cf-connecting-ip': '1.2.3.4',
      'fastly-client-ip': '1.2.3.4',
      'x-original-forwarded-for': '1.2.3.4',
      'x-original-remote-addr': '1.2.3.4',
      via: '1.1 proxy',
      [AMCORE_CLIENT_IP_HEADER]: '9.9.9.9',
      'content-type': 'application/json',
    })

    const forwarded = forwardRequestHeaders(source, 'at-1')

    expect(forwarded.has('forwarded')).toBe(false)
    expect(forwarded.has('x-forwarded-for')).toBe(false)
    expect(forwarded.has('x-forwarded-host')).toBe(false)
    expect(forwarded.has('x-forwarded-proto')).toBe(false)
    expect(forwarded.has('x-real-ip')).toBe(false)
    expect(forwarded.has('x-client-ip')).toBe(false)
    expect(forwarded.has('client-ip')).toBe(false)
    expect(forwarded.has('true-client-ip')).toBe(false)
    expect(forwarded.has('cf-connecting-ip')).toBe(false)
    expect(forwarded.has('fastly-client-ip')).toBe(false)
    expect(forwarded.has('x-original-forwarded-for')).toBe(false)
    expect(forwarded.has('x-original-remote-addr')).toBe(false)
    expect(forwarded.has('via')).toBe(false)
    expect(forwarded.has(AMCORE_CLIENT_IP_HEADER)).toBe(false)
    // Unrelated headers survive — this isn't a blanket strip.
    expect(forwarded.get('content-type')).toBe('application/json')
  })
})

describe('forwardResponseHeaders', () => {
  it('strips content-encoding/content-length/connection/transfer-encoding/set-cookie', () => {
    const source = new Headers({
      'content-encoding': 'gzip',
      'content-length': '999',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'set-cookie': 'refresh_token=leaked; HttpOnly',
      'content-type': 'application/json',
      'x-request-id': 'req-1',
    })

    const forwarded = forwardResponseHeaders(source)

    expect(forwarded.has('content-encoding')).toBe(false)
    expect(forwarded.has('content-length')).toBe(false)
    expect(forwarded.has('connection')).toBe(false)
    expect(forwarded.has('transfer-encoding')).toBe(false)
    expect(forwarded.has('set-cookie')).toBe(false)
    expect(forwarded.get('content-type')).toBe('application/json')
    expect(forwarded.get('x-request-id')).toBe('req-1')
  })
})
