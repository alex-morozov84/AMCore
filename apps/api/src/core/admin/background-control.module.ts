import { Module } from '@nestjs/common'

import { EnvModule } from '../../env/env.module.js'
import { PrismaModule } from '../../prisma/index.js'
import { AuditModule } from '../audit/index.js'

import { BackgroundCommandAdmission } from './background-command-admission.js'
import { BackgroundCommandService } from './background-command-service.js'
import { BackgroundCommandSettlement } from './background-command-settlement.js'
import { BackgroundControlAuthority } from './background-control-authority.js'
import { BackgroundControlBudgets } from './background-control-budgets.js'
import { BackgroundControlReservations } from './background-control-reservations.js'

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
