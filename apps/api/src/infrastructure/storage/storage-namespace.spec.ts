import { InvalidObjectKeyError } from './object-key'
import {
  assertSameNamespace,
  classifyListPrefix,
  isPublicKey,
  PUBLIC_KEY_PREFIX,
  resolveUploadVisibility,
  visibilityOf,
} from './storage-namespace'
import { buildBucketRootUrl, buildPublicRouteUrl } from './storage-public-url'

describe('public key namespace', () => {
  it('treats only keys under the reserved prefix as public', () => {
    expect(PUBLIC_KEY_PREFIX).toBe('public/')
    expect(isPublicKey('public/avatars/u1/a.webp')).toBe(true)
    expect(isPublicKey('avatars/u1/original')).toBe(false)
    expect(isPublicKey('publication/a.webp')).toBe(false)
    expect(isPublicKey('x/public/a.webp')).toBe(false)
  })

  it('normalizes before classifying so spacing or doubled slashes cannot bypass the rule', () => {
    expect(isPublicKey('  public//a.webp ')).toBe(true)
    expect(() => isPublicKey('public/../secret')).toThrow(InvalidObjectKeyError)
  })

  it('derives visibility from the key', () => {
    expect(visibilityOf('public/a.webp')).toBe('public-read')
    expect(visibilityOf('a.webp')).toBe('private')
  })

  it('accepts an omitted or matching visibility and rejects a contradiction', () => {
    expect(resolveUploadVisibility('public/a')).toBe('public-read')
    expect(resolveUploadVisibility('public/a', 'public-read')).toBe('public-read')
    expect(resolveUploadVisibility('a')).toBe('private')
    expect(resolveUploadVisibility('a', 'private')).toBe('private')
    expect(() => resolveUploadVisibility('a', 'public-read')).toThrow(InvalidObjectKeyError)
    expect(() => resolveUploadVisibility('public/a', 'private')).toThrow(InvalidObjectKeyError)
  })

  it('refuses copy or move across the namespace in both directions', () => {
    expect(() => assertSameNamespace('public/a', 'public/b')).not.toThrow()
    expect(() => assertSameNamespace('a', 'b')).not.toThrow()
    expect(() => assertSameNamespace('public/a', 'b')).toThrow(InvalidObjectKeyError)
    expect(() => assertSameNamespace('a', 'public/b')).toThrow(InvalidObjectKeyError)
  })

  it.each([
    ['public/avatars/u1/', 'public'],
    ['public/', 'public'],
    ['avatars/u1/', 'private'],
    ['publication/', 'private'],
    ['', 'ambiguous'],
    ['p', 'ambiguous'],
    ['pub', 'ambiguous'],
    ['public', 'ambiguous'],
  ] as const)('classifies the list prefix %p as %s', (prefix, expected) => {
    expect(classifyListPrefix(prefix)).toBe(expected)
  })
})

describe('public URL builders', () => {
  it('joins the bucket-root base and an encoded key without synthesis', () => {
    expect(buildBucketRootUrl('https://cdn.example.com', 'public/a/b c.webp')).toBe(
      'https://cdn.example.com/public/a/b%20c.webp'
    )
    expect(buildBucketRootUrl('https://cdn.example.com/media///', 'public/a.webp')).toBe(
      'https://cdn.example.com/media/public/a.webp'
    )
  })

  it('builds the API route form with one encoded query value', () => {
    expect(
      buildPublicRouteUrl('https://api.example.com/api/v1/storage/public/', 'public/a b.webp')
    ).toBe('https://api.example.com/api/v1/storage/public?key=public%2Fa%20b.webp')
  })

  it.each([buildBucketRootUrl, buildPublicRouteUrl])(
    'refuses a private or invalid key (%p)',
    (build) => {
      expect(() => build('https://cdn.example.com', 'avatars/u1/original')).toThrow(
        InvalidObjectKeyError
      )
      expect(() => build('https://cdn.example.com', '../public/a')).toThrow(InvalidObjectKeyError)
    }
  )
})
