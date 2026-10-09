import { useTranslations } from 'next-intl'

import 'client-only'

/**
 * Translated catalogue wording. Descriptor keys come from code (possibly a downstream
 * descriptor), so they cannot be checked against the catalogue types; `has` guards every
 * lookup and a missing translation degrades to the raw id instead of breaking the editor.
 */
export function useCatalogueText() {
  const t = useTranslations('organizationRoles')
  type Key = Parameters<typeof t.has>[0]
  const lookup = (key: string) => {
    const typed = key as Key
    return t.has(typed) ? t(typed) : undefined
  }
  return {
    area: (subject: string) => lookup(`areas.${subject}`) ?? subject,
    capability: (labelKey: string) => {
      const label = lookup(`capabilities.${labelKey}.label`)
      return label === undefined
        ? undefined
        : { label, description: lookup(`capabilities.${labelKey}.description`) }
    },
    level: (preset: string) => ({
      label: lookup(`levels.${preset}`) ?? preset,
      hint: lookup(`levelHints.${preset}`),
    }),
  }
}
