import { Module } from '@nestjs/common'

import { PrismaModule } from '../../prisma'
import { AuthModule } from '../auth/auth.module'

import { MemberService } from './member.service'
import { MembersController } from './members.controller'
import { OrganizationsController } from './organizations.controller'
import { OrganizationsService } from './organizations.service'
import { RoleService } from './role.service'
import { RolesController } from './roles.controller'

@Module({
  imports: [
    PrismaModule,
    AuthModule, // Provides TokenService (for /switch) + AuthenticationGuard (global)
  ],
  controllers: [OrganizationsController, MembersController, RolesController],
  providers: [OrganizationsService, MemberService, RoleService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
