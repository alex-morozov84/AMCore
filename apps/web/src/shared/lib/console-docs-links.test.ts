import { describe, expect, it } from 'vitest'

import { docsFolderHref, docsPageHref } from './console-docs-links'

describe('console docs links', () => {
  it('builds page and folder addresses from the one repository address', () => {
    expect(docsPageHref('docs/a.md')).toBe(
      'https://github.com/alex-morozov84/AMCore/blob/main/docs/a.md'
    )
    expect(docsPageHref('docs/a.md', 'part')).toBe(
      'https://github.com/alex-morozov84/AMCore/blob/main/docs/a.md#part'
    )
    expect(docsFolderHref('docs/operations/runbooks')).toBe(
      'https://github.com/alex-morozov84/AMCore/tree/main/docs/operations/runbooks'
    )
  })
})
