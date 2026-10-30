// @vitest-environment node
import {
  AbortError,
  ClientClosedError,
  ClientOfflineError,
  ConnectionTimeoutError,
  DisconnectsClientError,
  SimpleError,
  SocketClosedUnexpectedlyError,
  SocketTimeoutError,
  TimeoutError,
} from '@redis/client'
import { describe, expect, it } from 'vitest'

import { isVaultRedisUnavailable } from './vault-redis-failure'
import { VaultRedisError } from './vault-redis-types'

const withCode = (code: string): Error => Object.assign(new Error('connect failed'), { code })

describe('isVaultRedisUnavailable', () => {
  it.each([
    ['AbortError', new AbortError()],
    ['ClientClosedError', new ClientClosedError()],
    ['ClientOfflineError', new ClientOfflineError()],
    ['ConnectionTimeoutError', new ConnectionTimeoutError()],
    ['DisconnectsClientError', new DisconnectsClientError()],
    ['SocketClosedUnexpectedlyError', new SocketClosedUnexpectedlyError()],
    ['SocketTimeoutError', new SocketTimeoutError(1000)],
    ['TimeoutError', new TimeoutError()],
    ['ECONNRESET', withCode('ECONNRESET')],
    ['ECONNREFUSED', withCode('ECONNREFUSED')],
    ['BUSY reply', new SimpleError('BUSY Redis is busy running a script.')],
    ['LOADING reply', new SimpleError('LOADING Redis is loading the dataset in memory')],
  ])('treats %s as an outage', (_name, error) => {
    expect(isVaultRedisUnavailable(error)).toBe(true)
  })

  it.each([
    ['TypeError', new TypeError('x is not a function')],
    ['WRONGTYPE reply', new SimpleError('WRONGTYPE Operation against a key')],
    ['script error reply', new SimpleError('ERR Error compiling script')],
    ['plain error', new Error('boom')],
    ['SyntaxError from corrupt data', new SyntaxError('Unexpected token')],
    ['non-error value', 'ECONNRESET'],
  ])('keeps %s visible as a non-outage', (_name, error) => {
    expect(isVaultRedisUnavailable(error)).toBe(false)
  })

  it.each(['capacity', 'not_ready', 'deadline'] as const)(
    'treats the %s reason as an outage',
    (reason) => {
      expect(isVaultRedisUnavailable(new VaultRedisError(reason, 'not_sent'))).toBe(true)
    }
  )

  it('never treats a synchronous dispatch error as an outage, whatever its cause', () => {
    const dispatch = new VaultRedisError('dispatch', 'not_sent', { cause: new ClientClosedError() })
    expect(isVaultRedisUnavailable(dispatch)).toBe(false)
  })

  it.each([
    ['transport cause', new SocketClosedUnexpectedlyError(), true],
    ['operational reply', new SimpleError('BUSY x'), true],
    ['WRONGTYPE', new SimpleError('WRONGTYPE x'), false],
    ['TypeError', new TypeError('bad'), false],
  ])('unwraps a command failure with %s', (_name, cause, expected) => {
    expect(isVaultRedisUnavailable(new VaultRedisError('command', 'unknown', { cause }))).toBe(
      expected
    )
  })
})
