import { type ScheduledJobsResponse, scheduledJobsResponseSchema } from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

/**
 * First snapshot of the Scheduled jobs screen. A job no worker reported is typed data inside a
 * successful response; `DataOutcome`'s `unavailable` means this request itself failed.
 */
export function fetchConsoleScheduledJobs(): Promise<DataOutcome<ScheduledJobsResponse>> {
  return fetchBackend('/api/v1/admin/background-work/scheduled-jobs', scheduledJobsResponseSchema, {
    auth: 'required',
    cache: 'no-store',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
