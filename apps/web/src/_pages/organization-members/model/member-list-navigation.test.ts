import { describe, expect, it } from 'vitest'

import { memberListHref } from './member-list-navigation'

describe('member view navigation', () => {
  it('encodes search rather than allowing it to alter placement or query parameters', () => {
    expect(memberListHref('/crm/team', { search: 'a&b / Ю', page: 2 })).toBe(
      '/crm/team?search=a%26b+%2F+%D0%AE&page=2'
    )
    expect(memberListHref('/crm/team', { search: '', page: 1 })).toBe('/crm/team')
  })
})
