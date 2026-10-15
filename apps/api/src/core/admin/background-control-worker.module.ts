import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma/index.js'

import { BackgroundControlModule } from './background-control.module.js'
import { BackgroundControlMaintenance } from './background-control-maintenance.js'

@Module({
  imports: [PrismaModule, BackgroundControlModule],
  providers: [BackgroundControlMaintenance],
})
export class BackgroundControlWorkerModule {}
