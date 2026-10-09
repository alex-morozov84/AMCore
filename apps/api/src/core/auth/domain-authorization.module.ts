import { Module } from '@nestjs/common'

import { DomainAuthorizationService } from './domain-authorization.service'

import { PrismaModule } from '@/prisma'

@Module({
  imports: [PrismaModule],
  providers: [DomainAuthorizationService],
  exports: [DomainAuthorizationService],
})
export class DomainAuthorizationModule {}
