import type { WorkerHost } from '@nestjs/bullmq'
import type { INestApplication } from '@nestjs/common'

import {
  MANAGED_WORKERS,
  type ManagedWorkerBinding,
} from '../../../src/infrastructure/background-work/work-coordinator'

/** Domain integration tests stop generated wake hosts while exercising PG-owned work directly. */
export async function closeManagedWorker(
  app: Pick<INestApplication, 'get'>,
  workId: string,
  force = false
): Promise<void> {
  const binding = app
    .get<readonly ManagedWorkerBinding[]>(MANAGED_WORKERS, { strict: false })
    .find((candidate) => candidate.workId === workId)
  if (!binding) throw new Error('MISSING_MANAGED_TEST_WORKER')
  await app.get<WorkerHost>(binding.host, { strict: false }).worker.close(force)
}
