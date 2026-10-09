'use client'
import { useTranslations } from 'next-intl'
import type { MemberAccess } from '@amcore/shared'

import { Alert, AlertDescription } from '@/shared/ui/alert'

import { wideningNotes } from '../model/access-view'

/** What a reader should know about the shape of the whole answer before reading the rows. */
export function AccessNotes({ access }: { access: MemberAccess }) {
  const t = useTranslations('memberAccess')
  const notes = wideningNotes(access)
  return (
    <div className="space-y-2">
      {access.qualifiers.includes('platformSuperAdmin') && (
        <Alert variant="warning">
          <AlertDescription className="text-card-foreground">
            {t('qualifierSuperAdmin')}
          </AlertDescription>
        </Alert>
      )}
      {access.widening.status === 'unavailable' && (
        <Alert>
          <AlertDescription>{t('wideningUnavailable')}</AlertDescription>
        </Alert>
      )}
      {notes.map((note) => (
        <Alert key={note} variant={note === 'vetoed' ? 'warning' : 'default'}>
          <AlertDescription className="text-card-foreground">{t(note)}</AlertDescription>
        </Alert>
      ))}
      {access.unsafeLinkCount > 0 && (
        <Alert>
          <AlertDescription>{t('unsafeLinks', { count: access.unsafeLinkCount })}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}

/** Permissions outside the capability catalogue: said once, collapsed, with who must act to change it. */
export function OtherPermissions({ access }: { access: MemberAccess }) {
  const t = useTranslations('memberAccess')
  if (access.uncovered.ruleCount === 0) return null
  const roles = access.uncovered.roleSample.map((role) => role.name).join(', ')
  return (
    <details className="rounded-lg border border-border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        {t('otherTitle', { count: access.uncovered.ruleCount })}
      </summary>
      <p className="mt-2 text-muted-foreground">{t('otherBody')}</p>
      {roles && <p className="mt-1 text-muted-foreground">{t('otherRoles', { roles })}</p>}
    </details>
  )
}
