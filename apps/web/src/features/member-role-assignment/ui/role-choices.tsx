'use client'

import { useTranslations } from 'next-intl'

import { RoleChoices as SharedRoleChoices } from '@/shared/ui/role-choices'

import type { RoleChecklist } from './role-checklist'

type Props = React.ComponentProps<typeof RoleChecklist> & {
  pending: boolean
  error?: unknown
  unavailable?: boolean
  onRetry(): void
  retryDisabled?: boolean
}
export function RoleChoices(props: Props) {
  const t = useTranslations('organizationMembers')
  return (
    <SharedRoleChoices
      {...props}
      labels={{
        system: t('system'),
        custom: t('custom'),
        noDescription: t('noDescription'),
        empty: t('emptyRoles'),
      }}
      regionLabels={{
        roleList: t('roleList'),
        loading: t('loading'),
        retry: t('retry'),
        unavailable: t('readUnavailable'),
      }}
    />
  )
}
