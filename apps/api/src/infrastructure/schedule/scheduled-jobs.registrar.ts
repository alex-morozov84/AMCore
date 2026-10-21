import { Injectable, type OnApplicationBootstrap, Optional } from '@nestjs/common'
import { SchedulerRegistry } from '@nestjs/schedule'

import { EnvService } from '../../env/env.service.js'

import { ScheduledJobRecorder } from './scheduled-job-recorder.js'
import { SCHEDULED_JOBS, validateScheduledJobs } from './scheduled-jobs.catalogue.js'

const SCHEDULER_WAIT_MS = 5000
const POLL_MS = 100

/**
 * Worker/all only: reports the catalogue to the database when the process starts. The planned next
 * fire comes from the scheduler, which mounts its jobs during application bootstrap, so the
 * registrar waits (bounded) until every cron job is mounted instead of relying on hook order.
 */
@Injectable()
export class ScheduledJobsRegistrar implements OnApplicationBootstrap {
  constructor(
    private readonly recorder: ScheduledJobRecorder,
    private readonly env: EnvService,
    @Optional() private readonly scheduler?: SchedulerRegistry
  ) {}

  /** Never blocks application start: registration runs in the background and logs its own failure. */
  onApplicationBootstrap(): void {
    validateScheduledJobs(SCHEDULED_JOBS)
    void this.registerWhenMounted()
  }

  private async registerWhenMounted(): Promise<void> {
    await this.waitForScheduler()
    await this.recorder.registerJobs([...SCHEDULED_JOBS], (definition) =>
      definition.disabledReason ? definition.disabledReason(this.env) : null
    )
  }

  private async waitForScheduler(): Promise<void> {
    const registry = this.scheduler
    if (!registry) return
    const deadline = Date.now() + SCHEDULER_WAIT_MS
    const cronIds = SCHEDULED_JOBS.filter((job) => job.schedule.kind === 'cron').map(
      (job) => job.id
    )
    while (Date.now() < deadline && !cronIds.every((id) => registry.doesExist('cron', id))) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    }
  }
}
