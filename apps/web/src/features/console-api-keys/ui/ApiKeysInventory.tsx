'use client'

import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminApiKey, AdminApiKeyListResponse } from '@amcore/shared'
import { RefreshCw } from 'lucide-react'

import { getConsoleDetailAuditHref } from '@/shared/lib/console-public-href'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'

import { ApiKeyInventoryRows } from './ApiKeyInventoryRows'
import { ApiKeyRevokeFlow } from './ApiKeyRevokeFlow'
import { useApiKeySelection } from './use-api-key-selection'

export function ApiKeysInventory({
  response,
  identity,
  returnTo,
  headings,
  filtered,
}: {
  filtered: boolean
  response: AdminApiKeyListResponse
  identity: string
  returnTo: string
  headings: React.ReactNode
}) {
  const t = useTranslations('console.apiKeys')
  const router = useRouteProgressRouter()
  const [pending, startTransition] = useTransition()
  const {
    selected,
    targets,
    busy,
    refresh,
    eligible,
    checked,
    toggle,
    pick,
    success,
    close,
    setBusy,
    setSelected,
  } = useApiKeySelection(response, identity)
  const selection = (row: AdminApiKey) =>
    row.status !== 'revoked' ? (
      <Checkbox
        checked={checked.has(row.id)}
        disabled={busy}
        aria-label={t('selectKey', { name: row.name })}
        onCheckedChange={() => toggle(row.id)}
      />
    ) : null
  const menu = (row: AdminApiKey) => (
    <RowActionsMenu label={t('actionsFor', { name: row.name })}>
      {row.status !== 'revoked' && (
        <DropdownMenuItem variant="destructive" disabled={busy} onClick={() => pick([row])}>
          {t('revoke')}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        render={
          <RouteProgressLink
            href={getConsoleDetailAuditHref({ targetType: 'API_KEY', targetId: row.id })}
            prefetch={false}
          />
        }
      >
        {t('audit')}
      </DropdownMenuItem>
    </RowActionsMenu>
  )
  return (
    <section className="space-y-3" aria-busy={pending}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {t('total', { count: response.total })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="destructive"
            size="sm"
            disabled={busy || !selected.length}
            onClick={() => pick(response.data.filter((row) => checked.has(row.id)))}
          >
            {t('revokeSelected', { count: selected.length })}
          </Button>
          <Button
            ref={refresh}
            variant="outline"
            size="sm"
            disabled={pending || busy}
            onClick={() => startTransition(() => router.refresh())}
          >
            <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} />
            {t('refresh')}
          </Button>
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm has-[[data-disabled]]:cursor-not-allowed">
        <Checkbox
          disabled={busy || !eligible.length}
          checked={eligible.length > 0 && eligible.every((row) => checked.has(row.id))}
          onCheckedChange={(checked) => setSelected(checked ? eligible.map((row) => row.id) : [])}
        />
        {t('selectPage')}
      </label>
      {!response.data.length ? (
        <p className="rounded-md border border-border p-6 text-muted-foreground">
          {t(filtered ? 'filteredEmpty' : 'empty')}
        </p>
      ) : (
        <ApiKeyInventoryRows
          rows={response.data}
          headings={headings}
          returnTo={returnTo}
          selection={selection}
          menu={menu}
        />
      )}
      <p className="text-xs text-muted-foreground">{t('usageNote')}</p>
      <p className="text-xs text-muted-foreground">{t('lifecycleNote')}</p>
      {targets && (
        <ApiKeyRevokeFlow
          key={targets.map((row) => row.id).join(',')}
          targets={targets}
          onBusy={setBusy}
          onSuccess={success}
          onClose={close}
        />
      )}
    </section>
  )
}
