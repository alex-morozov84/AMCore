import type { AdminAuditResponse } from '@amcore/shared'

import { Disclosure } from '@/shared/ui/disclosure'

import type { AuditCopy } from './audit-copy'
import { CopyAuditId } from './CopyAuditId'

type Details = AdminAuditResponse['items'][number]['commandDetails']

/** One safe, closed details view shared by desktop rows and mobile cards. */
export function AuditCommandDetails({ details, copy }: { details: Details; copy: AuditCopy }) {
  if (!details) return null
  const labels = copy.commandDetails
  const fields = Object.entries(details) as [keyof NonNullable<Details>, string | number][]
  return (
    <Disclosure label={labels.title} className="mt-2">
      <dl className="space-y-2 rounded-md bg-muted p-3">
        {fields.map(([key, value]) => (
          <div key={key}>
            <dt className="text-xs text-muted-foreground">{labels[key]}</dt>
            <dd className="flex items-start gap-1 break-all">
              <span>
                {key === 'operation'
                  ? labels.operations[value as keyof typeof labels.operations]
                  : key === 'outcome'
                    ? labels.outcomes[value as keyof typeof labels.outcomes]
                    : key === 'resolution'
                      ? labels.resolutions[value as keyof typeof labels.resolutions]
                      : value}
              </span>
              {['commandId', 'jobId', 'workId'].includes(key) && (
                <CopyAuditId
                  id={String(value)}
                  label={copy.copyId}
                  copied={copy.copied}
                  failed={copy.copyFailed}
                />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Disclosure>
  )
}
