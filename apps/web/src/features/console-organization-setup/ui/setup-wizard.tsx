'use client'

import { useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'

import type { SetupFlow } from './bound-setup'
import { SetupAdministrator } from './setup-administrator'
import { SetupCompanyForm } from './setup-company-form'
import { SetupReview } from './setup-review'

export function SetupWizard({ flow, throttled }: { flow: SetupFlow; throttled: boolean }) {
  const t = useTranslations('console.organizationSetup')
  const { record, account } = flow
  const selected = account.isSuccess ? account.data : undefined
  const requested = record?.step ?? (record?.selected ? 'organization' : 'administrator')
  const step = selected?.emailVerified ? requested : 'administrator'
  const number = step === 'administrator' ? 1 : step === 'organization' ? 2 : 3
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [step])
  if (!record) return null
  return (
    <div className="max-w-2xl space-y-5">
      <p>{t('description')}</p>
      <ol aria-label={t('progress')} className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
        {(['administrator', 'organization', 'review'] as const).map((item, index) => (
          <li
            key={item}
            aria-current={item === step ? 'step' : undefined}
            className={
              item === step
                ? 'border-l-2 border-primary pl-3 font-semibold'
                : 'border-l-2 border-border pl-3 text-muted-foreground'
            }
          >
            {index + 1}. {t(`steps.${item}`)}
          </li>
        ))}
      </ol>
      <div>
        <p className="text-sm text-muted-foreground">{t('stepNumber', { number })}</p>
        <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {t(`headings.${step}`)}
        </h3>
      </div>
      {step === 'administrator' ? (
        <SetupAdministrator flow={flow} throttled={throttled} />
      ) : !flow.editable || account.isFetching ? (
        <p role="status">{t('loading')}</p>
      ) : step === 'organization' && selected ? (
        <>
          <div className="space-y-1">
            <p className="break-words">{t('selected', { email: selected.email })}</p>
            <p className="text-sm text-muted-foreground">{t('verified')}</p>
          </div>
          <p>{t('organizationHelp')}</p>
          <SetupCompanyForm
            initial={{ name: record.draft.name, slug: record.draft.slug }}
            onDraft={(draft) => flow.setDraft({ ...record.draft, ...draft })}
            onSubmit={flow.review}
            onBack={() => flow.goTo('administrator')}
          />
        </>
      ) : selected ? (
        <SetupReview flow={flow} selected={selected} disabled={throttled} />
      ) : null}
      {account.isError && (
        <Button variant="outline" disabled={throttled} onClick={() => void flow.refresh()}>
          {t('refresh')}
        </Button>
      )}
    </div>
  )
}
