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

import { BoundedRedisError } from './bounded-redis.js'
import { isRedisUnavailable } from './redis-failure-classifier.js'

const withCode = (code: string): Error => Object.assign(new Error('connect failed'), { code })

describe('isRedisUnavailable', () => {
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
    ['ETIMEDOUT', withCode('ETIMEDOUT')],
    ['BUSY reply', new SimpleError('BUSY Redis is busy running a script.')],
    ['LOADING reply', new SimpleError('LOADING Redis is loading the dataset in memory')],
    ['TRYAGAIN reply', new SimpleError('TRYAGAIN try later')],
  ])('treats %s as an outage', (_name, error) => {
    expect(isRedisUnavailable(error)).toBe(true)
  })

  it.each([
    ['TypeError', new TypeError('x is not a function')],
    [
      'WRONGTYPE reply',
      new SimpleError('WRONGTYPE Operation against a key holding the wrong kind'),
    ],
    ['script syntax reply', new SimpleError("ERR Error compiling script: '=' expected")],
    ['script runtime reply', new SimpleError('ERR value is not an integer or out of range')],
    ['custom script error', new SimpleError('MYERR custom')],
    ['plain error', new Error('boom')],
    ['non-error value', 'ECONNRESET'],
    ['undefined', undefined],
  ])('keeps %s visible as a non-outage', (_name, error) => {
    expect(isRedisUnavailable(error)).toBe(false)
  })

  describe('BoundedRedisError', () => {
    it.each(['capacity', 'not_ready', 'deadline'] as const)(
      'treats reason %s as an outage',
      (reason) => {
        expect(isRedisUnavailable(new BoundedRedisError(reason, 'not_sent'))).toBe(true)
      }
    )

    it('does not treat a synchronous dispatch error as an outage', () => {
      const dispatch = new BoundedRedisError('dispatch', 'not_sent', {
        cause: new ClientClosedError(),
      })
      expect(isRedisUnavailable(dispatch)).toBe(false)
    })

    it.each([
      ['transport cause', new SocketClosedUnexpectedlyError(), true],
      ['lifecycle cause', new DisconnectsClientError(), true],
      ['operational reply', new SimpleError('BUSY x'), true],
      ['WRONGTYPE', new SimpleError('WRONGTYPE x'), false],
      ['TypeError', new TypeError('bad'), false],
    ])('unwraps a command failure with %s', (_name, cause, expected) => {
      expect(isRedisUnavailable(new BoundedRedisError('command', 'unknown', { cause }))).toBe(
        expected
      )
    })

    it('never reads the outcome from the cause', () => {
      const error = new BoundedRedisError('command', 'unknown', {
        cause: new SocketClosedUnexpectedlyError(),
      })
      expect(error.outcome).toBe('unknown')
    })
  })

  it('unwraps nested causes up to a fixed depth', () => {
    const wrap = (cause: unknown): Error => new Error('wrapper', { cause })
    expect(isRedisUnavailable(wrap(wrap(new ClientClosedError())))).toBe(true)
    let deep: unknown = new ClientClosedError()
    for (let i = 0; i < 6; i++) deep = wrap(deep)
    expect(isRedisUnavailable(deep)).toBe(false)
  })
})
