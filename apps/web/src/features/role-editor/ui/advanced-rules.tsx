'use client'
import { useTranslations } from 'next-intl'
import type { AdvancedRule } from '@amcore/shared'

/** Stored rules the editor does not manage: read-only, never rewritten by a save. */
export function AdvancedRules({ rules }: { rules: readonly AdvancedRule[] }) {
  const t = useTranslations('organizationRoles')
  if (rules.length === 0) return null
  return (
    <section aria-labelledby="advanced-rules-title" className="space-y-2">
      <h3 id="advanced-rules-title" className="text-base font-semibold">
        {t('advancedTitle')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('advancedHint')}</p>
      <ul className="max-h-64 divide-y divide-line-soft overflow-y-auto rounded-lg border border-border">
        {rules.map((rule) => (
          <li key={rule.permissionId} className="space-y-1 px-4 py-2 text-sm">
            <p className="font-medium">
              {t('advancedRule', {
                inverted: String(rule.inverted),
                action: rule.action,
                subject: rule.subject,
              })}
            </p>
            {rule.fields.length > 0 && (
              <p className="text-muted-foreground">
                {t('advancedFields', { fields: rule.fields.join(', ') })}
              </p>
            )}
            {rule.conditions !== null && (
              <code className="block break-all text-xs text-muted-foreground">
                {JSON.stringify(rule.conditions)}
              </code>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
