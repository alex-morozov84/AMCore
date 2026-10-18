import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'

import { docsFolderHref, docsPageHref } from '@/shared/lib/console-docs-links'
import {
  CONSOLE_EXTERNAL_TOOLS,
  type ConsoleExternalLinks,
  type ConsoleExternalTool,
} from '@/shared/lib/console-external-links'
import { cn } from '@/shared/lib/utils'
import { buttonVariants } from '@/shared/ui/button'
import { InfoTooltip } from '@/shared/ui/info-tooltip'

import type { OverviewTranslations } from './overview-types'

const LABELS = {
  metrics: 'externalToolsMetrics',
  logs: 'externalToolsLogs',
  alerts: 'externalToolsAlerts',
} as const satisfies Record<ConsoleExternalTool, string>

const HOW_TO_HREF = docsPageHref('docs/operations-console/configuration.md', 'external-tool-links')
const RECOVERY_HREF = docsFolderHref('docs/operations/runbooks')

/** Opens in a new tab: said to everyone, not only to those who can see the icon. */
function NewTabLink({
  href,
  className,
  t,
  children,
}: {
  href: string
  className?: string
  t: OverviewTranslations
  children: ReactNode
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <ExternalLink aria-hidden className="ml-1 inline size-4 align-text-bottom" />
      <span className="sr-only"> {t('backgroundWork.board.openLinkNewTab')}</span>
    </a>
  )
}

/**
 * Links to the monitoring tools the operator configured, plus the public recovery instructions.
 * Plain text, not a disabled button, says what is missing: a disabled control is skipped by the
 * keyboard and hides its reason. The addresses arrive already normalized by the server.
 */
export function OverviewExternalTools({
  links,
  t,
}: {
  links: ConsoleExternalLinks
  t: OverviewTranslations
}) {
  const configured = CONSOLE_EXTERNAL_TOOLS.filter((tool) => links[tool] !== null)
  const missing = CONSOLE_EXTERNAL_TOOLS.filter((tool) => links[tool] === null)
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{t('externalToolsTitle')}</h2>
        <InfoTooltip label={t('externalToolsHelp')} />
      </div>
      {configured.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('externalToolsNone')}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-3">
          {configured.map((tool) => (
            <NewTabLink
              key={tool}
              href={links[tool] as string}
              t={t}
              className={cn(buttonVariants({ variant: 'outline' }))}
            >
              {t(LABELS[tool])}
            </NewTabLink>
          ))}
        </div>
      )}
      {configured.length > 0 && missing.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {missing.map((tool) => (
            <li key={tool}>{t('externalToolsToolNotConfigured', { tool: t(LABELS[tool]) })}</li>
          ))}
        </ul>
      )}
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {missing.length > 0 && (
          <NewTabLink href={HOW_TO_HREF} t={t} className="underline">
            {t('externalToolsHowTo')}
          </NewTabLink>
        )}
        <NewTabLink href={RECOVERY_HREF} t={t} className="underline">
          {t('externalToolsRecovery')}
        </NewTabLink>
      </p>
    </section>
  )
}
