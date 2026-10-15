import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma/index.js'

import { DomainAuthorizationService } from './domain-authorization.service.js'

@Module({
  imports: [PrismaModule],
  providers: [DomainAuthorizationService],
  exports: [DomainAuthorizationService],
})
export class DomainAuthorizationModule {}
