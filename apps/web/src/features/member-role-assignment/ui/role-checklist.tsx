'use client'

import { useTranslations } from 'next-intl'
import type { MemberRoleSummary } from '@amcore/shared'

import { RoleChecklist as SharedRoleChecklist } from '@/shared/ui/role-checklist'

export function RoleChecklist(props: { roles: MemberRoleSummary[]; selected: string[]; disabled: boolean;
  readOnly: boolean; onChange(ids: string[]): void }) {
  const t = useTranslations('organizationMembers')
  return <SharedRoleChecklist {...props} labels={{ system: t('system'), custom: t('custom'),
    noDescription: t('noDescription'), empty: t('emptyRoles') }} />
}
