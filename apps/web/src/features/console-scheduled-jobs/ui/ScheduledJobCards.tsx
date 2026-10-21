'use client'

import { useTranslations } from 'next-intl'
import type { ScheduledJob } from '@amcore/shared'

import { JobDuration, JobLastSuccess, JobName, JobNotes, JobSchedule } from './job-details'
import { JobFreshness, JobResult } from './job-status'
import { ScheduledJobHistory } from './ScheduledJobHistory'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  )
}

function JobCard({ job, instance }: { job: ScheduledJob; instance: string }) {
  const t = useTranslations('console.scheduledJobs')
  const duration = 'durationMs' in job.result ? job.result.durationMs : null
  return (
    <li className="rounded-lg border bg-surface-elevated p-4 shadow-md">
      <JobName job={job} />
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <Field label={t('columnResult')}>
          {job.config.state === 'enabled' ? <JobResult result={job.result} /> : t('noValue')}
        </Field>
        <Field label={t('columnFreshness')}>
          <JobFreshness job={job} />
        </Field>
        <Field label={t('columnLastSuccess')}>
          <JobLastSuccess job={job} />
        </Field>
        <Field label={t('columnDuration')}>
          <JobDuration ms={duration} />
        </Field>
        <Field label={t('columnSchedule')}>
          <JobSchedule job={job} />
        </Field>
      </dl>
      <div className="mt-3">
        <JobNotes job={job} />
        {job.cadence === 'daily' && job.config.state === 'enabled' && (
          <ScheduledJobHistory jobId={job.id} instance={instance} />
        )}
      </div>
    </li>
  )
}

/** Mobile presentation (below md): one card per job, same fields as the table. */
export function ScheduledJobCards({ jobs, instance }: { jobs: ScheduledJob[]; instance: string }) {
  const t = useTranslations('console.scheduledJobs')
  return (
    <ul aria-label={t('tableLabel')} className="flex flex-col gap-3 md:hidden">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} instance={instance} />
      ))}
    </ul>
  )
}
