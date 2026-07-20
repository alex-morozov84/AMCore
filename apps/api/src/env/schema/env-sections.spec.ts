import type { z } from 'zod'

import { envBaseSchema, envSections } from '../../env'

// Guards the section composition in base.ts: the flat spread of section `.shape`s is
// last-wins, so a key accidentally declared in two sections would be silently
// overwritten. These assertions make that a hard failure.

const sectionShape = (section: unknown): Record<string, unknown> =>
  (section as z.ZodObject).shape as Record<string, unknown>

describe('env schema section composition', () => {
  it('declares no key in more than one domain section', () => {
    const owner = new Map<string, string>()
    const duplicates: string[] = []
    for (const [name, section] of Object.entries(envSections)) {
      for (const key of Object.keys(sectionShape(section))) {
        const existing = owner.get(key)
        if (existing) duplicates.push(`${key} (in "${existing}" and "${name}")`)
        else owner.set(key, name)
      }
    }
    expect(duplicates).toEqual([])
  })

  it('composes the base schema from exactly the union of section keys', () => {
    const union = new Set<string>()
    for (const section of Object.values(envSections)) {
      for (const key of Object.keys(sectionShape(section))) union.add(key)
    }
    expect(new Set(Object.keys(envBaseSchema.shape))).toEqual(union)
  })
})
