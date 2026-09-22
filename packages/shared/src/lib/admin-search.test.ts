import { describe, expect, it } from 'vitest'

import { escapeLikeLiteral } from './admin-search'

describe('escapeLikeLiteral', () => {
  it('escapes percent and underscore so they match literally', () => {
    expect(escapeLikeLiteral('50% off')).toBe('50\\% off')
    expect(escapeLikeLiteral('user_name')).toBe('user\\_name')
  })

  it('escapes a literal backslash before escaping the character after it', () => {
    // Order matters: escaping `%`/`_` first would double-escape a backslash
    // that already precedes one of them.
    expect(escapeLikeLiteral('C:\\Users\\%')).toBe('C:\\\\Users\\\\\\%')
  })

  it('leaves an ordinary term unchanged', () => {
    expect(escapeLikeLiteral('alice')).toBe('alice')
    expect(escapeLikeLiteral('Алиса')).toBe('Алиса')
  })

  it('leaves an empty string unchanged', () => {
    expect(escapeLikeLiteral('')).toBe('')
  })
})
