import { useTranslations } from 'next-intl'
import { CAPABILITY_CATALOGUE } from '@amcore/shared'

/** Human labels are compact; the owning details disclosure preserves raw history. */
export function KeyPermissions({ scopes }: { scopes: readonly string[] }) {
  const catalogue = useTranslations('organizationRoles')
  const t = useTranslations('apiKeyPresentation')
  return (
    <ul className="flex flex-wrap gap-2">
      {[...new Set(scopes)].map((scope, index) => {
        const entry = CAPABILITY_CATALOGUE.find((c) => `${c.action}:${c.subject}` === scope)
        return (
          <li
            key={`${scope}:${index}`}
            className="rounded border border-border bg-muted px-2 py-1 text-sm"
          >
            {entry ? catalogue(`capabilities.${entry.labelKey}.label`) : t('additionalRestriction')}
          </li>
        )
      })}
    </ul>
  )
}
