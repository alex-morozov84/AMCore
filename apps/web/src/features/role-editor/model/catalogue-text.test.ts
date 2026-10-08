import { CAPABILITY_CATALOGUE } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

type Roles = typeof en.organizationRoles
const catalogues: [string, Roles][] = [
  ['en', en.organizationRoles],
  ['ru', ru.organizationRoles],
]

describe.each(catalogues)('catalogue wording (%s)', (_locale, roles) => {
  it.each(CAPABILITY_CATALOGUE.map((c) => [c.id, c.labelKey]))(
    'translates the label and description of %s',
    (_id, labelKey) => {
      const entry = (roles.capabilities as Record<string, { label: string; description: string }>)[
        labelKey
      ]
      expect(entry?.label).toBeTruthy()
      expect(entry?.description).toBeTruthy()
    }
  )

  it('names every area and level a descriptor can use', () => {
    const areas = roles.areas as Record<string, string>
    const levels = roles.levels as Record<string, string>
    const hints = roles.levelHints as Record<string, string>
    for (const capability of CAPABILITY_CATALOGUE) {
      expect(areas[capability.subject], capability.subject).toBeTruthy()
      for (const preset of capability.presets) {
        expect(levels[preset], preset).toBeTruthy()
        expect(hints[preset], preset).toBeTruthy()
      }
    }
  })
})
