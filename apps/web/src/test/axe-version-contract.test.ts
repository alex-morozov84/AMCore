import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const playwrightRequire = createRequire(require.resolve('@axe-core/playwright'))

describe('accessibility engine consistency', () => {
  it('uses the same direct axe-core version and Playwright engine', () => {
    const directVersion = require('axe-core/package.json').version as string
    const playwrightVersion = playwrightRequire('axe-core/package.json').version as string

    expect(
      playwrightVersion,
      'Update axe-core and @axe-core/playwright together so browser checks use the same rules.'
    ).toBe(directVersion)
  })
})
