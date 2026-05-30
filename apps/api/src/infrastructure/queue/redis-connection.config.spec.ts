import { buildBullConnection } from './redis-connection.config'

describe('buildBullConnection', () => {
  it('parses host, port, and db from a standard redis:// url', () => {
    const opts = buildBullConnection('redis://localhost:6379/2')

    expect(opts.host).toBe('localhost')
    expect(opts.port).toBe(6379)
    expect(opts.db).toBe(2)
  })

  it('defaults port to 6379 and db to 0 when absent', () => {
    const opts = buildBullConnection('redis://localhost')

    expect(opts.port).toBe(6379)
    expect(opts.db).toBe(0)
  })

  it('treats a bare "/" path as db 0', () => {
    const opts = buildBullConnection('redis://localhost:6379/')

    expect(opts.db).toBe(0)
  })

  it('does NOT set tls for redis://', () => {
    const opts = buildBullConnection('redis://localhost:6379')

    expect(opts.tls).toBeUndefined()
  })

  it('sets tls (with SNI servername) for rediss://', () => {
    const opts = buildBullConnection('rediss://cache.example.com:6380')

    expect(opts.tls).toEqual({ servername: 'cache.example.com' })
  })

  it('parses username and password (Redis 6 ACL)', () => {
    const opts = buildBullConnection('redis://alice:s3cr3t@localhost:6379')

    expect(opts.username).toBe('alice')
    expect(opts.password).toBe('s3cr3t')
  })

  it('omits username when only a password is present', () => {
    const opts = buildBullConnection('redis://:s3cr3t@localhost:6379')

    expect(opts.username).toBeUndefined()
    expect(opts.password).toBe('s3cr3t')
  })

  it('percent-decodes credentials with special characters', () => {
    const opts = buildBullConnection('redis://user:p%40ss%3Aword@localhost:6379')

    expect(opts.password).toBe('p@ss:word')
  })

  it('mirrors the RedisConnectionService reconnect curve (50ms step, 2s cap)', () => {
    const opts = buildBullConnection('redis://localhost:6379')
    const retry = opts.retryStrategy as (times: number) => number

    expect(retry(1)).toBe(50)
    expect(retry(10)).toBe(500)
    expect(retry(100)).toBe(2000) // capped
  })

  it('never sets maxRetriesPerRequest on the producer connection', () => {
    const opts = buildBullConnection('redis://localhost:6379')

    expect(opts.maxRetriesPerRequest).toBeUndefined()
  })
})
