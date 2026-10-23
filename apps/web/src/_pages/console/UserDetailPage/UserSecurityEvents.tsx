import { getTranslations } from 'next-intl/server'

import { getConsoleUserSecurityHrefs } from '@/shared/lib/console-public-href'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'

export async function UserSecurityEvents({ userId }: { userId: string }) {
  const t = await getTranslations('console.detail.login')
  const hrefs = getConsoleUserSecurityHrefs(userId)
  return (
    <section className="space-y-3" aria-label={t('securityEvents')}>
      <h2 className="text-xl font-semibold">{t('securityEvents')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <RouteProgressLink
            prefetch={false}
            href={hrefs.confirmations}
            className="text-sm underline underline-offset-2"
          >
            {t('confirmations')}
          </RouteProgressLink>
          <p className="text-sm text-muted-foreground">{t('confirmationsHelp')}</p>
        </div>
        <div className="space-y-1">
          <RouteProgressLink
            prefetch={false}
            href={hrefs.access}
            className="text-sm underline underline-offset-2"
          >
            {t('access')}
          </RouteProgressLink>
          <p className="text-sm text-muted-foreground">{t('accessHelp')}</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('historyHelp')}</p>
    </section>
  )
}
