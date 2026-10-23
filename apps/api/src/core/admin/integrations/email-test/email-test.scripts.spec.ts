import { emailTestKeys } from './email-test.keys.js'
import { EMAIL_TEST_SCRIPTS } from './email-test.scripts.js'

describe('email test Redis contract', () => {
  it('builds every key name in one factory with a shared hash tag', () => {
    const names = [
      emailTestKeys.attempt('id'),
      emailTestKeys.actor('user'),
      emailTestKeys.cooldown('user'),
      emailTestKeys.last,
      emailTestKeys.quota,
      emailTestKeys.lease,
    ]
    for (const name of names) expect(name).toMatch(/^integrations:\{email_test\}:/)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(Object.entries(EMAIL_TEST_SCRIPTS))(
    '%s passes every key it touches through KEYS',
    (_name, script) => {
      const calls = [...script.matchAll(/redis\.call\(\s*'[A-Z]+'\s*,\s*([^,)\s]+)/g)]
      expect(calls.length).toBeGreaterThan(0)
      for (const [, key] of calls) expect(key).toMatch(/^KEYS\[\d\]$/)
    }
  )

  it.each(Object.entries(EMAIL_TEST_SCRIPTS))(
    '%s reads time only from Redis TIME',
    (_n, script) => {
      expect(script).toContain("redis.call('TIME')")
      expect(script).not.toMatch(/os\.time|os\.clock/)
    }
  )
})

/** The KEYS/ARGV table of the lifecycle: the store passes exactly these counts to each script. */
const CONTRACT = {
  prepare: { keys: 1, args: 5 },
  reserve: { keys: 6, args: 14 },
  markSending: { keys: 3, args: 2 },
  failBeforeSend: { keys: 3, args: 3 },
  settle: { keys: 3, args: 4 },
} as const

describe('email test script argument contract', () => {
  const indexes = (script: string, name: 'KEYS' | 'ARGV'): number[] =>
    [...script.matchAll(new RegExp(`${name}\\[(\\d+)\\]`, 'g'))].map((match) => Number(match[1]))

  it.each(Object.entries(CONTRACT))(
    '%s uses exactly its declared keys and arguments',
    (name, shape) => {
      const script = EMAIL_TEST_SCRIPTS[name as keyof typeof EMAIL_TEST_SCRIPTS]
      const keys = new Set(indexes(script, 'KEYS'))
      expect([...keys].sort((a, b) => a - b)).toEqual(
        Array.from({ length: shape.keys }, (_unused, index) => index + 1)
      )
      expect(Math.max(...indexes(script, 'ARGV'))).toBe(shape.args)
    }
  )
})
