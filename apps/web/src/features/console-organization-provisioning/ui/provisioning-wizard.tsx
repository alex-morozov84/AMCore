'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'

import type { useProvisioning } from '../model/use-provisioning'

import { ProvisioningAdministratorForm } from './administrator-form'
import { ProvisioningCompanyForm } from './company-form'

export type ProvisioningFlow = ReturnType<typeof useProvisioning>
export function ProvisioningWizard({
  flow,
  blocked,
}: {
  flow: ProvisioningFlow
  blocked: boolean
}) {
  const t = useTranslations('console.organizationProvisioning')
  const [resetVersion, setResetVersion] = useState(0)
  const [resetOpen, setResetOpen] = useState(false)
  const row = flow.record!
  const draft = row.draft
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [row.step])
  const titles = { 1: 'organizationStep', 2: 'administratorStep', 3: 'reviewStep' } as const
  return (
    <div className="space-y-4">
      <h3 ref={heading} tabIndex={-1} className="font-semibold">
        {t('step', { step: row.step })}: {t(titles[row.step])}
      </h3>
      <Button
        variant="outline"
        disabled={flow.frozen || flow.busy}
        onClick={() => setResetOpen(true)}
      >
        {t('reset')}
      </Button>
      {row.step === 1 ? (
        <ProvisioningCompanyForm
          key={resetVersion}
          initial={{ name: draft.name, slug: draft.slug }}
          onDraft={(value) => flow.edit({ ...draft, ...value })}
          onNext={(value) => flow.edit({ ...draft, ...value }, 2)}
          onCancel={flow.close}
        />
      ) : row.step === 2 ? (
        <ProvisioningAdministratorForm
          initial={{ firstAdminEmail: draft.firstAdminEmail, inviteLocale: draft.inviteLocale }}
          onDraft={(value) => flow.edit({ ...draft, ...value })}
          onNext={(value) => flow.edit({ ...draft, ...value }, 3)}
          onBack={() => flow.edit(draft, 1)}
        />
      ) : (
        <div className="space-y-4">
          <p>{t('reviewHelp')}</p>
          <dl className="grid gap-2 text-sm">
            <dt className="text-muted-foreground">{t('name')}</dt>
            <dd>{draft.name}</dd>
            <dt className="text-muted-foreground">{t('slug')}</dt>
            <dd>{draft.slug || t('automaticSlug')}</dd>
            <dt className="text-muted-foreground">{t('email')}</dt>
            <dd className="break-all">{draft.firstAdminEmail}</dd>
            <dt className="text-muted-foreground">{t('role')}</dt>
            <dd>{t('administrator')}</dd>
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={flow.busy} onClick={() => flow.edit(draft, 2)}>
              {t('back')}
            </Button>
            <Button disabled={blocked || flow.busy} onClick={() => void flow.submit()}>
              {t('createAndInvite')}
            </Button>
          </div>
        </div>
      )}
      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('resetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('resetHelp')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('back')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={flow.frozen || flow.busy}
              onClick={() => {
                flow.reset()
                setResetVersion((v) => v + 1)
                setResetOpen(false)
              }}
            >
              {t('resetConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
