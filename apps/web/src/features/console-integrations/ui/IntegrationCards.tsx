'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationItem } from '@amcore/shared'

import {
  IntegrationFacts,
  IntegrationLastCheck,
  IntegrationName,
  IntegrationSetup,
} from './integration-cells'
import { IntegrationLinks } from './IntegrationLinks'
import { ProbeAction } from './ProbeAction'

function Field({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function Card({ item, now, online }: { item: IntegrationItem; now: number; online: boolean }) {
  const t = useTranslations('console.integrations')
  return (
    <li className="rounded-lg border bg-surface-elevated p-4 shadow-md">
      <IntegrationName item={item} now={now} />
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Field label={t('columnProvider')}>
          <IntegrationFacts item={item} />
        </Field>
        <Field label={t('columnSetup')}>
          <IntegrationSetup item={item} />
        </Field>
        <Field label={t('columnLastCheck')} className="col-span-2">
          <IntegrationLastCheck item={item} now={now} />
        </Field>
      </dl>
      <div className="mt-3 space-y-2">
        <ProbeAction item={item} online={online} />
        <IntegrationLinks item={item} />
      </div>
    </li>
  )
}

/** Mobile presentation (below md): one card per service with the same fields as the table. */
export function IntegrationCards({
  items,
  now,
  online,
}: {
  items: IntegrationItem[]
  now: number
  online: boolean
}) {
  const t = useTranslations('console.integrations')
  return (
    <ul aria-label={t('tableLabel')} className="flex flex-col gap-3 md:hidden">
      {items.map((item) => (
        <Card key={item.id} item={item} now={now} online={online} />
      ))}
    </ul>
  )
}
