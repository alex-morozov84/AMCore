import { type AdminQueuesResponse, adminQueuesResponseSchema } from '@amcore/shared'

import { type DataOutcome, fetchBackend } from '@/shared/api/server'

import { getConsoleAwareAccessToken } from './access-token'

import 'server-only'

/**
 * First snapshot of the Background work screen. A queue that could not be read is typed `unavailable`
 * data inside a successful response; `DataOutcome`'s `unavailable` means this request itself failed.
 */
export function fetchConsoleQueues(): Promise<DataOutcome<AdminQueuesResponse>> {
  return fetchBackend('/api/v1/admin/background-work/queues', adminQueuesResponseSchema, {
    auth: 'required',
    cache: 'no-store',
    tokenResolver: getConsoleAwareAccessToken,
  })
}
