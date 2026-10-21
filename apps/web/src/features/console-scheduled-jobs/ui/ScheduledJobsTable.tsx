'use client'

import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import type { ScheduledJob } from '@amcore/shared'

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'

import { JobDuration, JobLastSuccess, JobName, JobNotes, JobSchedule } from './job-details'
import { JobFreshness, JobResult } from './job-status'
import { ScheduledJobHistory } from './ScheduledJobHistory'

function Row({ job }: { job: ScheduledJob }) {
  const duration = 'durationMs' in job.result ? job.result.durationMs : null
  return (
    <Fragment>
      <TableRow className="border-b-0">
        <TableCell className="align-top whitespace-normal">
          <JobName job={job} />
        </TableCell>
        <TableCell className="align-top whitespace-normal">
          <JobSchedule job={job} />
        </TableCell>
        <TableCell className="align-top">
          {job.config.state === 'enabled' ? (
            <JobResult result={job.result} />
          ) : (
            <span aria-hidden="true">—</span>
          )}
        </TableCell>
        <TableCell className="align-top">
          <JobFreshness job={job} />
        </TableCell>
        <TableCell className="align-top">
          <JobLastSuccess job={job} />
        </TableCell>
        <TableCell className="align-top tabular-nums">
          <JobDuration ms={duration} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={6} className="pt-0 pb-4 whitespace-normal">
          <JobNotes job={job} />
          {job.cadence === 'daily' && job.config.state === 'enabled' && (
            <ScheduledJobHistory jobId={job.id} />
          )}
        </TableCell>
      </TableRow>
    </Fragment>
  )
}

/** Desktop presentation (md and up). Hidden with `display: none` below, so assistive tech reads one list. */
export function ScheduledJobsTable({ jobs }: { jobs: ScheduledJob[] }) {
  const t = useTranslations('console.scheduledJobs')
  return (
    <div className="hidden rounded-lg border bg-surface-elevated shadow-md md:block">
      <Table aria-label={t('tableLabel')}>
        <TableHeader>
          <TableRow>
            <TableHead>{t('columnJob')}</TableHead>
            <TableHead>{t('columnSchedule')}</TableHead>
            <TableHead>{t('columnResult')}</TableHead>
            <TableHead>{t('columnFreshness')}</TableHead>
            <TableHead>{t('columnLastSuccess')}</TableHead>
            <TableHead>{t('columnDuration')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <Row key={job.id} job={job} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
