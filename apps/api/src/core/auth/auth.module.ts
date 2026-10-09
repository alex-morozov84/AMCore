import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvModule } from '../../env/env.module'
import { EnvService } from '../../env/env.service'
import { EmailModule } from '../../infrastructure/email'
import { GeoipModule } from '../../infrastructure/geoip/geoip.module'
import { MediaModule } from '../../infrastructure/media'
import { PrismaModule } from '../../prisma'
import { ApiKeysModule } from '../api-keys/api-keys.module'
import { AuditModule } from '../audit'
import { InvitationAuthorityModule } from '../invitations/invitation-authority.module'
import { NotificationsModule } from '../notifications/notifications.module'

import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { AvatarService } from './avatar.service'
import { AbilityFactory } from './casl/ability.factory'
import { EmailIdentityService } from './email-identity.service'
import {
  AuthenticationGuard,
  FreshAuthGuard,
  JwtAuthGuard,
  OriginCheckGuard,
  PoliciesGuard,
  RefreshTokenGuard,
  SystemRolesGuard,
} from './guards'
import { TeamAccessGuard } from './guards/team-access.guard'
import { InvitationHandoffsController } from './invitation-handoffs.controller'
import { LoginRateLimiterService } from './login-rate-limiter.service'
import { OAuthController } from './oauth/oauth.controller'
import { OAuthService } from './oauth/oauth.service'
import { OAuthClientService } from './oauth/oauth-client.service'
import { OAuthLoginTicketService } from './oauth/oauth-login-ticket.service'
import { OAuthStateService } from './oauth/oauth-state.service'
import { OAuthProviderFactory } from './oauth/providers/oauth-provider.factory'
import { OrgAclVersionService } from './org-acl-version.service'
import { OrganizationContextResolver } from './organization-context/organization-context-resolver.service'
import { PermissionsCacheService } from './permissions-cache.service'
import { PrivilegedAdmissionService } from './privileged-admission.service'
import { PrivilegedRoleService } from './privileged-role.service'
import { SessionService } from './session.service'
import { JwtStrategy } from './strategies/jwt.strategy'
import { TokenService } from './token.service'
import { TokenManagerService } from './token-manager.service'
import { UserCacheService } from './user-cache.service'

@Module({
  imports: [
    PrismaModule,
    InvitationAuthorityModule,
    PassportModule,
    EmailModule,
    ApiKeysModule,
    AuditModule,
    GeoipModule,
    MediaModule,
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [EnvModule],
      inject: [EnvService],
      useFactory: (env: EnvService): JwtModuleOptions => ({
        secret: env.get('JWT_SECRET'),
        signOptions: {
          expiresIn: env.get('JWT_ACCESS_EXPIRATION'),
        } as JwtModuleOptions['signOptions'],
      }),
    }),
  ],
  controllers: [AuthController, OAuthController, InvitationHandoffsController],
  providers: [
    AuthService,
    AvatarService,
    EmailIdentityService,
    LoginRateLimiterService,
    OAuthClientService,
    OAuthLoginTicketService,
    OAuthProviderFactory,
    OAuthService,
    OAuthStateService,
    TokenService,
    TokenManagerService,
    SessionService,
    JwtStrategy,
    OriginCheckGuard,
    RefreshTokenGuard,
    UserCacheService,
    // RBAC
    AbilityFactory,
    OrgAclVersionService,
    PermissionsCacheService,
    JwtAuthGuard,
    PoliciesGuard,
    TeamAccessGuard,
    PrivilegedRoleService,
    PrivilegedAdmissionService,
    OrganizationContextResolver,
    SystemRolesGuard,
    FreshAuthGuard,
    AuthenticationGuard,
    // Single global guard: authenticate → current privilege → build ability → authorize
    // Registered in AuthModule so it runs AFTER RateLimitGuard (ThrottlingModule)
    { provide: APP_GUARD, useClass: AuthenticationGuard },
  ],
  exports: [
    AuthService,
    UserCacheService,
    AbilityFactory,
    TokenService,
    EmailIdentityService,
    OrgAclVersionService,
    OrganizationContextResolver,
  ],
})
export class AuthModule {}
