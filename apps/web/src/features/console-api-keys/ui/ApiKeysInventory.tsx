'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import type { AdminApiKey, AdminApiKeyListResponse } from '@amcore/shared'
import { RefreshCw } from 'lucide-react'

import { getConsoleDetailAuditHref } from '@/shared/lib/console-public-href'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import { DropdownMenuItem } from '@/shared/ui/dropdown-menu'
import { RouteProgressLink } from '@/shared/ui/route-progress-link'
import { RowActionsMenu } from '@/shared/ui/row-actions-menu'
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@/shared/ui/table'

import { ApiKeyName, ApiKeyOrganization, ApiKeyOwner, ApiKeyTime } from './ApiKeyMetadata'
import { ApiKeyRevokeFlow } from './ApiKeyRevokeFlow'

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
  const [selected, setSelected] = useState<string[]>([])
  const [targets, setTargets] = useState<AdminApiKey[] | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useRef<HTMLButtonElement>(null)
  const previousIdentity = useRef(identity)
  useEffect(() => {
    const eligible = new Set(
      response.data.filter((row) => row.status !== 'revoked').map((row) => row.id)
    )
    setSelected((ids) =>
      previousIdentity.current !== identity ? [] : ids.filter((id) => eligible.has(id))
    )
    previousIdentity.current = identity
  }, [identity, response.data])
  const eligible = response.data.filter((row) => row.status !== 'revoked')
  const checked = new Set(selected)
  const toggle = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]))
  function pick(rows: AdminApiKey[]) {
    if (!busy && rows.length) {
      setTargets(rows)
      setBusy(true)
    }
  }
  function success() {
    setSelected([])
    setTargets(null)
    setBusy(false)
    refresh.current?.focus()
  }
  const selection = (row: AdminApiKey) =>
    row.status !== 'revoked' ? (
      <input
        type="checkbox"
        checked={checked.has(row.id)}
        disabled={busy}
        aria-label={t('selectKey', { name: row.name })}
        onChange={() => toggle(row.id)}
        className="size-4 accent-[var(--primary)]"
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
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-[var(--primary)]"
          disabled={busy || !eligible.length}
          checked={eligible.length > 0 && eligible.every((row) => checked.has(row.id))}
          onChange={(event) =>
            setSelected(event.target.checked ? eligible.map((row) => row.id) : [])
          }
        />
        {t('selectPage')}
      </label>
      {!response.data.length ? (
        <p className="rounded-md border border-border p-6 text-muted-foreground">
          {t(filtered ? 'filteredEmpty' : 'empty')}
        </p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border border-border bg-surface-elevated shadow-md md:block">
            <Table>
              <TableHeader>
                <TableRow>{headings}</TableRow>
              </TableHeader>
              <TableBody>
                {response.data.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{selection(row)}</TableCell>
                    <TableCell>
                      <ApiKeyName row={row} />
                    </TableCell>
                    <TableCell>
                      <ApiKeyOwner row={row} returnTo={returnTo} />
                    </TableCell>
                    <TableCell>
                      <ApiKeyOrganization row={row} returnTo={returnTo} />
                    </TableCell>
                    <TableCell>
                      {t(row.status)}
                      {row.revocationReason && (
                        <p className="text-xs text-muted-foreground">{t(row.revocationReason)}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <ApiKeyTime value={row.expiresAt} expiry />
                    </TableCell>
                    <TableCell>
                      <ApiKeyTime value={row.lastUsedAt} />
                    </TableCell>
                    <TableCell>
                      {row.revokedAt ? <ApiKeyTime value={row.revokedAt} /> : t('notApplicable')}
                    </TableCell>
                    <TableCell>
                      <ApiKeyTime value={row.createdAt} />
                    </TableCell>
                    <TableCell>{menu(row)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="space-y-3 md:hidden">
            {response.data.map((row) => (
              <li
                key={row.id}
                className="space-y-3 rounded-lg border border-border bg-surface-elevated p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  {selection(row)}
                  <ApiKeyName row={row} />
                  {menu(row)}
                </div>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">{t('owner')}</dt>
                    <dd>
                      <ApiKeyOwner row={row} returnTo={returnTo} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('organization')}</dt>
                    <dd>
                      <ApiKeyOrganization row={row} returnTo={returnTo} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('status')}</dt>
                    <dd>{t(row.status)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('expiry')}</dt>
                    <dd>
                      <ApiKeyTime value={row.expiresAt} expiry />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('usage')}</dt>
                    <dd>
                      <ApiKeyTime value={row.lastUsedAt} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">{t('created')}</dt>
                    <dd>
                      <ApiKeyTime value={row.createdAt} />
                    </dd>
                  </div>
                  {row.revokedAt && (
                    <div>
                      <dt className="text-muted-foreground">{t('revokedTime')}</dt>
                      <dd>
                        <ApiKeyTime value={row.revokedAt} />
                      </dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="text-xs text-muted-foreground">{t('usageNote')}</p>
      <p className="text-xs text-muted-foreground">{t('lifecycleNote')}</p>
      {targets && (
        <ApiKeyRevokeFlow
          key={targets.map((row) => row.id).join(',')}
          targets={targets}
          onBusy={setBusy}
          onSuccess={success}
          onClose={() => {
            setTargets(null)
            setBusy(false)
            refresh.current?.focus()
          }}
        />
      )}
    </section>
  )
}
