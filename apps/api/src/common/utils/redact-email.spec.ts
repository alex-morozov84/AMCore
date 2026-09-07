import { redactEmail } from './redact-email'

describe('redactEmail', () => {
  it('keeps the first local-part character and the full domain', () => {
    expect(redactEmail('alice@example.com')).toBe('a***@example.com')
    expect(redactEmail('b@corp-client.com')).toBe('b***@corp-client.com')
  })

  it('handles an address with no local part gracefully', () => {
    expect(redactEmail('@example.com')).toBe('***')
  })

  it('handles a value with no "@" gracefully', () => {
    expect(redactEmail('not-an-email')).toBe('***')
  })

  it('returns undefined for undefined input', () => {
    expect(redactEmail(undefined)).toBeUndefined()
  })
})
