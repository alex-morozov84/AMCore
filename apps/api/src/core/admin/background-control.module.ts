import { Module } from '@nestjs/common'

import { AuditModule } from '../audit'

import { BackgroundCommandAdmission } from './background-command-admission'
import { BackgroundCommandService } from './background-command-service'
import { BackgroundCommandSettlement } from './background-command-settlement'
import { BackgroundControlAuthority } from './background-control-authority'
import { BackgroundControlBudgets } from './background-control-budgets'
import { BackgroundControlReservations } from './background-control-reservations'

import { EnvModule } from '@/env/env.module'
import { PrismaModule } from '@/prisma'

const providers = [
  BackgroundCommandAdmission,
  BackgroundCommandService,
  BackgroundCommandSettlement,
  BackgroundControlAuthority,
  BackgroundControlBudgets,
  BackgroundControlReservations,
]

/** Shared PG authority, without HTTP controllers or a credential strategy dependency. */
@Module({ imports: [PrismaModule, EnvModule, AuditModule], providers, exports: providers })
export class BackgroundControlModule {}
