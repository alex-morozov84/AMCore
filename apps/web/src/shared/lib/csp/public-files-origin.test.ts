import { describe, expect, it } from 'vitest'

import { parsePublicFilesOrigin } from './public-files-origin'

describe('parsePublicFilesOrigin', () => {
  it.each([
    ['https://cdn.example.com', 'https://cdn.example.com'],
    ['https://files.example.com/assets/public?x=1', 'https://files.example.com'],
    ['  https://cdn.example.com:8443/  ', 'https://cdn.example.com:8443'],
    ['http://localhost:5002/api/v1/storage/public', 'http://localhost:5002'],
    ['http://127.0.0.1:20001', 'http://127.0.0.1:20001'],
  ])('keeps only the origin of %s', (raw, origin) => {
    expect(parsePublicFilesOrigin(raw)).toBe(origin)
  })

  it.each([
    undefined,
    '',
    '   ',
    'not a url',
    '*',
    'https://*.example.com',
    'http://cdn.example.com',
    'ftp://cdn.example.com',
    'https://user:pw@cdn.example.com',
    'javascript:alert(1)',
  ])('refuses %p, so the policy is never widened', (raw) => {
    expect(parsePublicFilesOrigin(raw)).toBeNull()
  })
})
