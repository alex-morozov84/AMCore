import { Module } from '@nestjs/common'

import { ScheduledJobsModule } from '../../infrastructure/schedule/scheduled-jobs.module.js'
import { PrismaModule } from '../../prisma/index.js'

import { BackgroundControlModule } from './background-control.module.js'
import { BackgroundControlMaintenance } from './background-control-maintenance.js'

@Module({
  imports: [PrismaModule, ScheduledJobsModule, BackgroundControlModule],
  providers: [BackgroundControlMaintenance],
})
export class BackgroundControlWorkerModule {}
