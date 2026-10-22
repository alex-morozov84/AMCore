import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma/index.js'

import { ScheduledJobExecutor } from './scheduled-job.executor.js'
import { ScheduledJobRecorder } from './scheduled-job-recorder.js'
import { SingletonCronRunner } from './singleton-cron.runner.js'

/**
 * Recording of scheduled-job evidence (executor + recorder). Provided WITHOUT the scheduler, like
 * `CleanupModule`, so a service that is also present in `web` can inject the executor; only
 * worker/all register jobs (`ScheduledJobsRegistrar`) and fire crons. Nest builds one module
 * instance per process, so every importer shares a single recorder.
 */
@Module({
  imports: [PrismaModule],
  providers: [ScheduledJobRecorder, ScheduledJobExecutor, SingletonCronRunner],
  exports: [ScheduledJobRecorder, ScheduledJobExecutor],
})
export class ScheduledJobsModule {}
