import { CAPABILITY_CATALOGUE, SUPPORTED_LOCALES } from '@amcore/shared'
import { describe, expect, it } from 'vitest'

/**
 * The role editor and the member Access view render the catalogue and only the catalogue: a
 * capability a product registers appears in both with the copy declared here. Without it a screen
 * would fall back to a raw id, so a missing key is caught where the capability is registered.
 */
describe.each([...SUPPORTED_LOCALES])('catalogue copy (%s)', (locale) => {
  it('names every capability, its area and the levels it offers', async () => {
    const messages = (await import(`../../../../messages/${locale}.json`)).default
    const roles = messages.organizationRoles as {
      capabilities: Record<string, { label?: string; description?: string }>
      areas: Record<string, string>
      levels: Record<string, string>
      levelHints: Record<string, string>
    }
    for (const entry of CAPABILITY_CATALOGUE) {
      const copy = roles.capabilities[entry.labelKey]
      expect(copy?.label, `${entry.id} label`).toBeTruthy()
      expect(copy?.description, `${entry.id} description`).toBeTruthy()
      expect(roles.areas[entry.subject], `${entry.subject} area`).toBeTruthy()
      for (const preset of entry.presets) {
        expect(roles.levels[preset], `${preset} level`).toBeTruthy()
        expect(roles.levelHints[preset], `${preset} level hint`).toBeTruthy()
      }
    }
  })
})
