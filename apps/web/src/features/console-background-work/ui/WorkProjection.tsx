import { useLocale, useTranslations } from 'next-intl'
import type { WorkJob, WorkSummary } from '@amcore/shared'

import { Disclosure } from '@/shared/ui/disclosure'

import { workLabel } from './work-label'

/** Registration owns labels, ordering and technical grouping of approved values. */
export function WorkProjection({
  work,
  values,
}: {
  work: WorkSummary
  values: WorkJob['projection']
}) {
  const locale = useLocale()
  const t = useTranslations('console.backgroundWork.control')
  const keys = [
    ...new Set([...Object.keys(work.presentation?.fields ?? {}), ...Object.keys(values)]),
  ].filter((key) => key in values)
  const technical = new Set(work.presentation?.technicalFields ?? [])
  const fields = (items: string[]) => (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map((key) => (
        <div key={key} className="min-w-0 space-y-1">
          <dt className="text-xs text-muted-foreground">
            {workLabel(work.presentation?.fields[key], locale, key)}
          </dt>
          <dd className="break-words font-medium">{String(values[key])}</dd>
        </div>
      ))}
    </dl>
  )
  return (
    <div className="space-y-3 rounded-md bg-muted/40 p-3">
      {fields(keys.filter((key) => !technical.has(key)))}
      {keys.some((key) => technical.has(key)) && (
        <Disclosure label={t('technicalDetails')}>
          {fields(keys.filter((key) => technical.has(key)))}
        </Disclosure>
      )}
    </div>
  )
}
