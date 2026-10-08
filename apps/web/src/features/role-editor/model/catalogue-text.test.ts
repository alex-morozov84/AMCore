import { CAPABILITY_CATALOGUE, SUPPORTED_LOCALES } from '@amcore/shared'
import { beforeAll, describe, expect, it } from 'vitest'

type Roles = {
  capabilities: Record<string, { label: string; description: string }>
  areas: Record<string, string>
  levels: Record<string, string>
  levelHints: Record<string, string>
}

// Catalogues are loaded by locale code, so the test follows whichever locales a project keeps.
describe.each([...SUPPORTED_LOCALES])('catalogue wording (%s)', (locale) => {
  let roles: Roles
  beforeAll(async () => {
    roles = (await import(`../../../../messages/${locale}.json`)).default.organizationRoles
  })

  it.each(CAPABILITY_CATALOGUE.map((c) => [c.id, c.labelKey]))(
    'translates the label and description of %s',
    (_id, labelKey) => {
      const entry = roles.capabilities[labelKey]
      expect(entry?.label).toBeTruthy()
      expect(entry?.description).toBeTruthy()
    }
  )

  it('names every area and level a descriptor can use', () => {
    for (const capability of CAPABILITY_CATALOGUE) {
      expect(roles.areas[capability.subject], capability.subject).toBeTruthy()
      for (const preset of capability.presets) {
        expect(roles.levels[preset], preset).toBeTruthy()
        expect(roles.levelHints[preset], preset).toBeTruthy()
      }
    }
  })
})
