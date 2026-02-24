import { Module } from '@nestjs/common'

import { ScheduleModule } from '../../infrastructure/schedule/schedule.module'
import { PrismaModule } from '../../prisma'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [PrismaModule, ScheduleModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
