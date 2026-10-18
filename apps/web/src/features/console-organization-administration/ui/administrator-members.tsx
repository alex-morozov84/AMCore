import { useTranslations } from 'next-intl'
import type { AdministratorSummary,AdminOrganizationDetailResponse } from '@amcore/shared'

import { Button } from '@/shared/ui/button'

import type { AdministratorDialogAction } from './administrator-dialog'

export function AdministratorMembers({
  members,
  administrators,
  blocked,
  onAction,
}: {
  members: AdminOrganizationDetailResponse['members']['data']
  administrators: AdministratorSummary['administrators']['data']
  blocked: boolean
  onAction: (action: AdministratorDialogAction) => void
}) {
  const t = useTranslations('console.organizationAdministration')
  if (!members.length || members.every(member => administrators.some(admin => admin.userId === member.user.id))) return null
  return (
    <section className="space-y-3">
      <h3 className="font-semibold">{t('promote')}</h3>
      <p className="text-sm text-muted-foreground">{t('selectMemberHelp')}</p>
      <ul className="space-y-2">
        {members.map((member) => (
          <li
            key={member.user.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          >
            <span className="break-all">{member.user.name ?? member.user.email}</span>
            {administrators.some((admin) => admin.userId === member.user.id) ? (
              <span className="text-sm text-muted-foreground">{t('alreadyAdministrator')}</span>
            ) : (
              <Button
                variant="outline"
                disabled={blocked || !member.memberId}
                onClick={() =>
                  onAction({
                    kind: 'assign',
                    userId: member.user.id,
                    memberId: member.memberId!,
                    email: member.user.email,
                    roles: member.roles.map((role) => role.name),
                  })
                }
              >
                {t('promote')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
