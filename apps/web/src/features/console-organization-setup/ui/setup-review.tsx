'use client'

import { useTranslations } from 'next-intl'
import type { OrganizationSetupAccount } from '@amcore/shared'

import { Button } from '@/shared/ui/button'

import type { SetupFlow } from './bound-setup'

export function SetupReview({
  flow,
  selected,
  disabled,
}: {
  flow: SetupFlow
  selected: OrganizationSetupAccount
  disabled: boolean
}) {
  const t = useTranslations('console.organizationSetup')
  const draft = flow.record!.draft
  return (
    <div className="space-y-4">
      <p>{t('reviewHelp')}</p>
      <dl className="space-y-3 rounded-md border p-4">
        <div>
          <dt className="text-sm text-muted-foreground">{t('name')}</dt>
          <dd className="break-words font-medium">{draft.name}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('slug')}</dt>
          <dd className="break-all">{draft.slug}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{t('administrator')}</dt>
          <dd className="break-words">{selected.email}</dd>
        </div>
      </dl>
      <p>{t('grantHelp', { email: selected.email })}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => flow.goTo('organization')}>
          {t('back')}
        </Button>
        <Button
          disabled={disabled}
          onClick={() =>
            flow.submit({
              kind: 'bootstrap',
              input: { name: draft.name, slug: draft.slug, adminUserId: selected.userId },
            })
          }
        >
          {t('finish')}
        </Button>
      </div>
    </div>
  )
}
