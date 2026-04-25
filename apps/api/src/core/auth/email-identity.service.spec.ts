import { EmailIdentityService } from './email-identity.service'

describe('EmailIdentityService', () => {
  let service: EmailIdentityService

  beforeEach(() => {
    service = new EmailIdentityService()
  })

  it('should trim display email for storage without changing case', () => {
    expect(service.normalizeForStorage('  User@Example.COM  ')).toBe('User@Example.COM')
  })

  it('should canonicalize email by trimming and case-folding', () => {
    expect(service.canonicalize('  User@Example.COM  ')).toBe('user@example.com')
  })

  it('should not remove plus tags', () => {
    expect(service.canonicalize('alex+billing@example.com')).toBe('alex+billing@example.com')
  })

  it('should not remove dots from local part', () => {
    expect(service.canonicalize('a.lex@example.com')).toBe('a.lex@example.com')
  })
})
