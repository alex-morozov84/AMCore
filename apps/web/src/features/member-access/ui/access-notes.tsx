'use client'
import { useTranslations } from 'next-intl'
import type { MemberAccess } from '@amcore/shared'

import { Alert, AlertDescription } from '@/shared/ui/alert'

import { wideningNotes } from '../model/access-view'

/** What a reader should know about the shape of the whole answer before reading the rows. */
export function AccessNotes({ access }: { access: MemberAccess }) {
  const t = useTranslations('memberAccess')
  const notes = wideningNotes(access)
  const names = (ids: { id: string; name: string }[]) => ids.map((role) => role.name).join(', ')
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
      {access.uncovered.ruleCount > 0 && (
        <Alert>
          <AlertDescription className="gap-1">
            <p>{t('uncovered', { count: access.uncovered.ruleCount })}</p>
            {access.uncovered.roleSample.length > 0 && (
              <p>{t('uncoveredRoles', { roles: names(access.uncovered.roleSample) })}</p>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  )
}
