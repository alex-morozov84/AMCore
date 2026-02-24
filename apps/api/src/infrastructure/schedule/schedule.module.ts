import { Module } from '@nestjs/common'
import { ScheduleModule as NestScheduleModule } from '@nestjs/schedule'

import { CleanupService } from './cleanup.service'

import { PrismaModule } from '@/prisma'

@Module({
  imports: [NestScheduleModule.forRoot(), PrismaModule],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class ScheduleModule {}
