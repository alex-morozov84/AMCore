'use client'

import type { ComponentType } from 'react'
import { useTranslations } from 'next-intl'
import type { ScheduledFreshness, ScheduledJob, ScheduledResult } from '@amcore/shared'
import {
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleSlash,
  CircleX,
  Clock,
  TriangleAlert,
} from 'lucide-react'

type Tone = 'success' | 'warning' | 'danger' | 'muted'
type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>

const TONE: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
}

/** Icon and word together: the state is never carried by colour alone. */
function Status({ tone, icon: Icon, children }: { tone: Tone; icon: Icon; children: string }) {
  return (
    <p className={`flex items-center gap-1.5 font-medium ${TONE[tone]}`}>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

const RESULT: Record<ScheduledResult['state'], { tone: Tone; icon: Icon }> = {
  success: { tone: 'success', icon: CircleCheck },
  partial: { tone: 'warning', icon: TriangleAlert },
  failed: { tone: 'danger', icon: CircleX },
  running: { tone: 'muted', icon: Clock },
  unknown: { tone: 'warning', icon: CircleHelp },
  none: { tone: 'muted', icon: CircleDashed },
}

export function JobResult({ result }: { result: ScheduledResult }) {
  const t = useTranslations('console.scheduledJobs.result')
  const { tone, icon } = RESULT[result.state]
  return (
    <Status tone={tone} icon={icon}>
      {t(result.state)}
    </Status>
  )
}

const FRESHNESS: Record<ScheduledFreshness['state'], { tone: Tone; icon: Icon }> = {
  fresh: { tone: 'success', icon: CircleCheck },
  stale: { tone: 'warning', icon: TriangleAlert },
  unknown: { tone: 'muted', icon: CircleHelp },
}

/** Freshness is judged only for a job a worker reported as turned on. */
export function JobFreshness({ job }: { job: ScheduledJob }) {
  const t = useTranslations('console.scheduledJobs.freshness')
  if (job.config.state === 'disabled')
    return (
      <Status tone="muted" icon={CircleSlash}>
        {t('disabled')}
      </Status>
    )
  const { tone, icon } = FRESHNESS[job.freshness.state]
  return (
    <Status tone={tone} icon={icon}>
      {t(job.freshness.state)}
    </Status>
  )
}
