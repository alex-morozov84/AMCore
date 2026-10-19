'use client'
import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import type { ApiKeyQuery, OwnApiKeyAdmission } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { OwnKeyOrganizationPicker, useOwnApiKeyController } from '@/entities/api-key'
import { useOrganizationContext } from '@/entities/organization-context'
import { OwnApiKeyCreate } from '@/features/own-api-key-create'
import { usePathname } from '@/i18n/navigation'
import { useRouteProgressRouter } from '@/shared/lib/route-progress/use-route-progress-router'
import { Button } from '@/shared/ui/button'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'

import { OwnApiKeys } from './own-api-keys'

export function OwnApiKeysHost({
  admission,
  query,
  invalidQuery,
  baseHref,
}: {
  admission: OwnApiKeyAdmission
  query: ApiKeyQuery
  invalidQuery: boolean
  baseHref: string
}) {
  const t = useTranslations('ownApiKeys')
  const [savedKey, setSavedKey] = useState<{ name: string; organizationId: string }>()
  const [target, setTarget] = useState<{ id: string; name: string }>()
  const [nextTarget, setNextTarget] = useState<{ id: string; name: string }>()
  const { controller, session } = useOwnApiKeyController(admission, target?.id)
  const client = useQueryClient()
  const router = useRouteProgressRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [queryView, setQueryView] = useOptimistic(query)
  const [, startTransition] = useTransition()
  const heading = useRef<HTMLDivElement>(null)
  const locale = useLocale()
  const context = useOrganizationContext(
    admission.binding,
    target ? { kind: 'selected', id: target.id, locale } : { kind: 'list', page: 1, locale }
  )
  useEffect(() => {
    if (context.state.status === 'missing' || context.state.status === 'changed')
      controller.session.retire()
  }, [context.state.status, controller])
  const canCreate =
    context.state.status === 'ready' &&
    context.data &&
    'canManageTeamAccess' in context.data.data &&
    context.data.data.canManageTeamAccess
  const verificationFailed = useSyncExternalStore(
    controller.session.subscribe,
    controller.session.getFailureSnapshot,
    () => false
  )
  const changeQuery = (next: ApiKeyQuery, reason: 'criteria' | 'page' = 'criteria') => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(next)) {
      if (
        key === 'limit' ||
        (key === 'status' && value === 'all') ||
        (key === 'page' && value === 1) ||
        !value
      )
        continue
      params.set(key, String(value))
    }
    const href = params.size ? `${baseHref}?${params}` : baseHref
    if (href === `${pathname}${searchParams.size ? `?${searchParams}` : ''}`) return
    startTransition(() => {
      setQueryView(next)
      if (reason === 'page') router.push(href, { scroll: false })
      else router.replace(href, { scroll: false })
    })
  }
  const refresh = () => client.invalidateQueries({ queryKey: ['own-api-keys', admission.binding] })
  if (session === 'retired')
    return (
      <div role="alert">
        <p>{t('sessionChanged')}</p>
        <Button onClick={() => window.location.reload()}>{t('reload')}</Button>
      </div>
    )
  return (
    <div className="space-y-6">
      {verificationFailed && (
        <div role="status">
          <p>{t('sessionCheckFailed')}</p>
          <Button variant="outline" onClick={() => void controller.session.freshCheck()}>
            {t('verify')}
          </Button>
        </div>
      )}
      <OwnApiKeyCreate
        controller={controller}
        organizationId={target?.id}
        organizationName={target?.name}
        canCreate={Boolean(canCreate)}
        authorityStatus={context.state.status}
        authorityError={context.state.error}
        verifyTarget={async () => (await context.refresh()) === 'ready'}
        organizationControl={
          <OwnKeyOrganizationPicker
            controller={controller}
            purpose="creation"
            selectedId={target?.id}
            onSelect={(option) => {
              if (!option || option.id === target?.id) return
              const next = { id: option.id, name: option.name }
              if (target) setNextTarget(next)
              else setTarget(next)
            }}
          />
        }
        inspectionFocusRef={heading}
        onSaved={setSavedKey}
        onInspect={async (inspection) => {
          if (inspection) {
            client.setQueryData(
              ['own-api-keys', admission.binding, { page: 1, limit: 20, status: 'all' }],
              inspection
            )
            changeQuery({ page: 1, limit: 20, status: 'all' })
            heading.current?.focus()
            heading.current?.scrollIntoView({ block: 'start' })
          }
          await refresh()
        }}
      />
      {savedKey && (
        <div role="status" className="space-y-2">
          {(queryView.page > 1 ||
            queryView.search ||
            queryView.organizationId ||
            queryView.organizationAvailability ||
            queryView.status !== 'all') && (
            <Button
              variant="outline"
              onClick={() =>
                changeQuery({
                  page: 1,
                  limit: 20,
                  status: 'all',
                  organizationId: savedKey.organizationId,
                })
              }
            >
              {t('showCreatedOrganization')}
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(nextTarget)}
        onOpenChange={(open) => {
          if (!open) setNextTarget(undefined)
        }}
        title={t('switchOrganization')}
        description={t('switchOrganizationHint')}
        confirmLabel={t('selectOrganization')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          setTarget(nextTarget)
          setNextTarget(undefined)
        }}
      />
      <div ref={heading} tabIndex={-1} />
      <OwnApiKeys
        controller={controller}
        disabled={session !== 'verified'}
        query={queryView}
        invalidQuery={invalidQuery}
        onQueryChange={changeQuery}
      />
    </div>
  )
}
