import { describe, expect, it } from 'vitest'

import { adminConsoleSettingsSchema } from './admin-console'
import { localeSettingsSchema } from './locales'
import corpus from './settings-contract.fixture.json'

// The generators in `scripts/` validate the same files without the Zod schemas (they run before
// anything is built). `scripts/lib/settings-files.test.mjs` runs this same fixture against that
// reader, so the two sides accept and refuse exactly the same files.
describe.each([
  ['locales.json', localeSettingsSchema, corpus.locales],
  ['admin-console.json', adminConsoleSettingsSchema, corpus.adminConsole],
] as const)('%s contract', (_name, schema, cases) => {
  it.each(cases.valid)('accepts: $name', ({ file }) => {
    expect(schema.safeParse(file).success).toBe(true)
  })
  it.each(cases.invalid)('refuses: $name', ({ file }) => {
    expect(schema.safeParse(file).success).toBe(false)
  })
})
