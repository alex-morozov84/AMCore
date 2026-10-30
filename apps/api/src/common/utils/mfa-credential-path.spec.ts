import { mfaCredentialPath } from './mfa-credential-path'

describe('MFA credential budget/redaction classification only widens closure', () => {
  it.each([
    '/api/v1/auth/mfa/status',
    '/api/v1/auth/login',
    '/api/v1/AUTH/%6dfa/status',
    '/api/v1/auth/%256dfa/status',
    '/api/v1//auth/browser-publications/probe/',
    '/api/v1/x/../auth/mfa',
    '/api/v1/auth/mfa/../login',
  ])('classifies %s without rewriting the URL', (url) => {
    expect(mfaCredentialPath(url, '/api/v1')).toBe(true)
  })
  it.each(['/api/v1/auth/register', '/api/v1/auth/mfax', '/other/auth/mfa'])(
    'keeps unrelated route %s outside its budget',
    (url) => {
      expect(mfaCredentialPath(url, '/api/v1')).toBe(false)
    }
  )
})
