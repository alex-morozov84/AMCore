import { ExternalLink } from 'lucide-react'

import { docsFolderHref, docsPageHref } from '@/shared/lib/console-docs-links'
import {
  CONSOLE_EXTERNAL_TOOLS,
  type ConsoleExternalLinks,
  type ConsoleExternalTool,
} from '@/shared/lib/console-external-links'
import { buttonVariants } from '@/shared/ui/button'
import { InfoTooltip } from '@/shared/ui/info-tooltip'
import { NewTabLink } from '@/shared/ui/new-tab-link'

import type { OverviewTranslations } from './overview-types'

const LABELS = {
  metrics: 'externalToolsMetrics',
  logs: 'externalToolsLogs',
  alerts: 'externalToolsAlerts',
} as const satisfies Record<ConsoleExternalTool, string>

const HOW_TO_HREF = docsPageHref('docs/operations-console/configuration.md', 'external-tool-links')
const RECOVERY_HREF = docsFolderHref('docs/operations/runbooks')

type ToolProps = { t: OverviewTranslations }

function ConfiguredTools({
  tools,
  t,
}: ToolProps & { tools: { tool: ConsoleExternalTool; href: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-3">
      {tools.map(({ tool, href }) => (
        <NewTabLink
          key={tool}
          href={href}
          newTabLabel={t('overviewPublicOpenNewTab')}
          className={buttonVariants({ variant: 'outline' })}
        >
          {t(LABELS[tool])}
          <ExternalLink aria-hidden className="size-4" />
        </NewTabLink>
      ))}
    </div>
  )
}

function UnconfiguredTools({ tools, t }: ToolProps & { tools: ConsoleExternalTool[] }) {
  return (
    <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
      {tools.map((tool) => (
        <li key={tool}>{t('externalToolsToolNotConfigured', { tool: t(LABELS[tool]) })}</li>
      ))}
    </ul>
  )
}

function GuideLinks({ showHowTo, t }: ToolProps & { showHowTo: boolean }) {
  const icon = <ExternalLink aria-hidden className="ml-1 inline size-4 align-text-bottom" />
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {showHowTo && (
        <NewTabLink
          href={HOW_TO_HREF}
          newTabLabel={t('overviewPublicOpenNewTab')}
          className="underline"
        >
          {t('externalToolsHowTo')}
          {icon}
        </NewTabLink>
      )}
      <NewTabLink
        href={RECOVERY_HREF}
        newTabLabel={t('overviewPublicOpenNewTab')}
        className="underline"
      >
        {t('externalToolsRecovery')}
        {icon}
      </NewTabLink>
    </p>
  )
}

/**
 * Links to the monitoring tools the operator configured, plus the public recovery instructions.
 * Plain text, not a disabled button, says what is missing: a disabled control is skipped by the
 * keyboard and hides its reason. The addresses arrive already normalized by the server.
 */
export function OverviewExternalTools({ links, t }: ToolProps & { links: ConsoleExternalLinks }) {
  const configured = CONSOLE_EXTERNAL_TOOLS.flatMap((tool) => {
    const href = links[tool]
    return href === null ? [] : [{ tool, href }]
  })
  const missing = CONSOLE_EXTERNAL_TOOLS.filter((tool) => links[tool] === null)
  return (
    <section className="rounded-lg border bg-surface-elevated p-6 shadow-md">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{t('externalToolsTitle')}</h2>
        <InfoTooltip label={t('externalToolsHelp')} />
      </div>
      {configured.length > 0 ? (
        <ConfiguredTools tools={configured} t={t} />
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t('externalToolsNone')}</p>
      )}
      {configured.length > 0 && missing.length > 0 && <UnconfiguredTools tools={missing} t={t} />}
      <GuideLinks showHowTo={missing.length > 0} t={t} />
    </section>
  )
}
