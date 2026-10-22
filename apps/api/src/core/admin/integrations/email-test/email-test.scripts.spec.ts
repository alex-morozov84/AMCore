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
