import { Module } from '@nestjs/common'

import { BackgroundControlModule } from './background-control.module'
import { BackgroundControlMaintenance } from './background-control-maintenance'

import { PrismaModule } from '@/prisma'

@Module({
  imports: [PrismaModule, BackgroundControlModule],
  providers: [BackgroundControlMaintenance],
})
export class BackgroundControlWorkerModule {}
