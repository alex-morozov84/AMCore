import { getTranslations } from 'next-intl/server'

import { IntegrationsLive } from '@/features/console-integrations'
import { fetchConsoleIntegrations } from '@/shared/api/console/integrations'
import { resolvePrimary } from '@/shared/api/server'
import { PrimaryUnavailableFallback } from '@/shared/ui/primary-unavailable-fallback'

/**
 * Integrations: safe state of the outside services the platform uses. The page waits for the first
 * snapshot before returning, so the Console frame's skeleton covers the wait; a transport failure of
 * that snapshot is the explicit primary-unavailable state and keeps the heading. Reading never starts
 * a check; the only action is the operator test email inside the live leaf.
 */
export async function IntegrationsPage() {
  const t = await getTranslations('console.integrations')
  // Rejected 4xx or malformed 2xx deliberately propagate to the real error boundary.
  const outcome = resolvePrimary(await fetchConsoleIntegrations(), {
    source: 'console-integrations',
  })
  return (
    <section className="flex flex-col gap-4">
      <header>
        <p className="font-console-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
          {t('eyebrow')}
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t('description')}</p>
      </header>
      {outcome.status === 'unavailable' ? (
        <PrimaryUnavailableFallback reason={outcome.reason} />
      ) : (
        <IntegrationsLive
          key={outcome.data.readAt}
          initial={outcome.data}
          initialUpdatedAt={Date.parse(outcome.data.readAt)}
        />
      )}
    </section>
  )
}
