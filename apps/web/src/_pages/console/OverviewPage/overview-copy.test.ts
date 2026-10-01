import { describe, expect, it } from 'vitest'

import en from '../../../../messages/en.json'
import ru from '../../../../messages/ru.json'

const catalogues = { en, ru }

describe('Overview pool readiness explanation', () => {
  it.each(Object.entries(catalogues))(
    '%s describes queue overflow as not ready, not degraded',
    (_locale, catalogue) => {
      const text = catalogue.console.overviewPoolHelp
      expect(text).toMatch(/not ready|не готов/i)
      expect(text).not.toMatch(/degrad|деград|снижает готовность/i)
    }
  )
})
