'use client'
import { useTranslations } from 'next-intl'

import {
  type OrganizationAccessController,
  useRoleDefinition,
} from '@/entities/organization-context'
import { Button } from '@/shared/ui/button'

/** Shows which role the list is narrowed to, with the way back to everyone. */
export function RoleFilter({
  controller,
  roleId,
  onClear,
}: {
  controller: OrganizationAccessController
  roleId: string
  onClear: () => void
}) {
  const t = useTranslations('organizationMembers')
  const role = useRoleDefinition(controller, roleId)
  const name = role.data?.role.name
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>{name ? t('roleFilter', { name }) : t('roleFilterUnknown')}</span>
      <Button variant="outline" size="sm" onClick={onClear}>
        {t('roleFilterClear')}
      </Button>
    </div>
  )
}
