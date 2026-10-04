import { describe, expect, it } from 'vitest'

import { BULL_BOARD_CONTENT_SECURITY_POLICY, parseBoardRenderContext } from './bull-board'

const valid = {
  basePath: '/api/console/bull-board',
  locale: 'en',
  returnHref: '/en/admin/background-work',
} as const

describe('board render context', () => {
  it('accepts a valid context', () => {
    expect(parseBoardRenderContext(valid)).toEqual(valid)
  })

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['extra key', { ...valid, role: 'SUPER_ADMIN' }],
    ['unknown locale', { ...valid, locale: 'de' }],
    ['absolute url', { ...valid, basePath: 'https://evil.example/x' }],
    ['protocol-relative', { ...valid, returnHref: '//evil.example' }],
    ['traversal', { ...valid, basePath: '/api/../admin' }],
    ['double slash', { ...valid, basePath: '/api//x' }],
    ['backslash', { ...valid, returnHref: '/en\\admin' }],
    ['query in href', { ...valid, returnHref: '/en/admin?x=1' }],
    ['control char', { ...valid, basePath: '/api/\n' }],
    ['too long', { ...valid, basePath: `/${'a'.repeat(250)}` }],
    ['missing field', { basePath: valid.basePath, locale: 'en' }],
  ])('rejects %s', (_label, value) => {
    expect(parseBoardRenderContext(value)).toBeNull()
  })
})

describe('board content security policy', () => {
  it('allows no framing, no remote scripts and no reporting endpoint', () => {
    expect(BULL_BOARD_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'")
    expect(BULL_BOARD_CONTENT_SECURITY_POLICY).toContain("script-src 'self'")
    expect(BULL_BOARD_CONTENT_SECURITY_POLICY).not.toMatch(/report-(uri|to)|https?:/)
  })
})
