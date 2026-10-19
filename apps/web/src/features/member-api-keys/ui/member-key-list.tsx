import { useFormatter, useTranslations } from 'next-intl'
import type { MemberKeyList } from '@amcore/shared'
import { Ban, Clock3, KeyRound } from 'lucide-react'

import { KeyStatus } from '@/entities/api-key'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/ui/empty'

const STATUS_VIEW = {
  unexpired: {
    Icon: KeyRound,
    card: 'border-l-success',
    badge: 'border-success/60 bg-success-soft text-foreground',
  },
  expired: {
    Icon: Clock3,
    card: 'border-l-warning',
    badge: 'border-warning/60 bg-warning-soft text-foreground',
  },
  revoked: {
    Icon: Ban,
    card: 'border-l-border bg-muted/30',
    badge: 'border-border bg-muted text-muted-foreground',
  },
} as const

export function MemberKeyListView({
  data,
  status,
  busy,
  onRevoke,
}: {
  data: MemberKeyList
  status: string
  busy: boolean
  onRevoke: (id: string, name: string) => void
}) {
  const t = useTranslations('memberApiKeys')
  const f = useFormatter()
  const date = (value: string | null) =>
    value
      ? f.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' })
      : t('notRecorded')
  return (
    <>
      {!data.data.length && (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {t(data.total ? 'outOfRange' : status !== 'all' ? 'noMatches' : 'empty')}
            </EmptyTitle>
            <EmptyDescription>{t('emptyHint')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <div className="space-y-3">
        {data.data.map((key) => {
          const { card } = STATUS_VIEW[key.status]
          return (
            <Card key={key.id} className={cn('border-l-4', card)}>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="break-all font-medium">{key.name}</h3>
                  <KeyStatus status={key.status} />
                </div>
                <dl className="grid gap-1 text-sm text-muted-foreground">
                  <div>
                    <dt className="inline">{t('created')}: </dt>
                    <dd className="inline">{date(key.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="inline">{t('expires')}: </dt>
                    <dd className="inline">
                      {key.expiresAt ? date(key.expiresAt) : t('noExpiry')}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline">{t('lastUsed')}: </dt>
                    <dd className="inline">{date(key.lastUsedAt)}</dd>
                  </div>
                </dl>
                <details>
                  <summary className="cursor-pointer text-sm">{t('scopes')}</summary>
                  <ul className="space-y-1 break-all text-sm">
                    {key.scopes.map((scope, i) => (
                      <li key={`${scope}:${i}`}>{scope}</li>
                    ))}
                  </ul>
                </details>
                {key.revocationReason && (
                  <p className="text-sm text-muted-foreground">{t(key.revocationReason)}</p>
                )}
                {key.revokedAt && (
                  <p className="text-sm text-muted-foreground">
                    {t('revokedOn', { date: date(key.revokedAt) })}
                  </p>
                )}
                {!key.revokedAt && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRevoke(key.id, key.name)}
                  >
                    {t('revoke')}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
