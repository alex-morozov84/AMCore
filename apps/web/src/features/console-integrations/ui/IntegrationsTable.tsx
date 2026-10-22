'use client'

import { useTranslations } from 'next-intl'
import type { IntegrationItem } from '@amcore/shared'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import {
  IntegrationFacts,
  IntegrationLastCheck,
  IntegrationLinks,
  IntegrationName,
  IntegrationSetup,
} from './integration-cells'
import { ProbeAction } from './ProbeAction'

function Row({ item, now }: { item: IntegrationItem; now: number }) {
  return (
    <TableRow>
      <TableCell className="align-top whitespace-normal">
        <IntegrationName item={item} now={now} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <IntegrationFacts item={item} />
      </TableCell>
      <TableCell className="align-top">
        <IntegrationSetup item={item} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <IntegrationLastCheck item={item} now={now} />
      </TableCell>
      <TableCell className="align-top whitespace-normal">
        <div className="space-y-2">
          <ProbeAction item={item} />
          <IntegrationLinks item={item} />
        </div>
      </TableCell>
    </TableRow>
  )
}

/** Desktop presentation (md and up). Hidden with `display: none` below, so assistive tech reads one list. */
export function IntegrationsTable({ items, now }: { items: IntegrationItem[]; now: number }) {
  const t = useTranslations('console.integrations')
  return (
    <div className="hidden rounded-lg border bg-surface-elevated shadow-md md:block">
      <Table aria-label={t('tableLabel')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columnService')}</TableHead>
            <TableHead>{t('columnProvider')}</TableHead>
            <TableHead>{t('columnSetup')}</TableHead>
            <TableHead>{t('columnLastCheck')}</TableHead>
            <TableHead>{t('columnAction')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <Row key={item.id} item={item} now={now} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
