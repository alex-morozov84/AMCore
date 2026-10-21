import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { JwtModule, type JwtModuleOptions } from '@nestjs/jwt'
import { PassportModule } from '@nestjs/passport'

import { EnvModule } from '../../env/env.module.js'
import { EnvService } from '../../env/env.service.js'
import { EmailModule } from '../../infrastructure/email/index.js'
import { GeoipModule } from '../../infrastructure/geoip/geoip.module.js'
import { MediaModule } from '../../infrastructure/media/index.js'
import { PrismaModule } from '../../prisma/index.js'
import { ApiKeysModule } from '../api-keys/api-keys.module.js'
import { AuditModule } from '../audit/index.js'
import { FrontendContextModule } from '../frontend-context/frontend-context.module.js'
import { InvitationAuthorityModule } from '../invitations/invitation-authority.module.js'
import { NotificationsModule } from '../notifications/notifications.module.js'

import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { AvatarService } from './avatar.service.js'
import { AbilityFactory } from './casl/ability.factory.js'
import { EmailIdentityService } from './email-identity.service.js'
import {
  AuthenticationGuard,
  FreshAuthGuard,
  JwtAuthGuard,
  OriginCheckGuard,
  PoliciesGuard,
  RefreshTokenGuard,
  SystemRolesGuard,
} from './guards/index.js'
import { TeamAccessGuard } from './guards/team-access.guard.js'
import { InvitationHandoffsController } from './invitation-handoffs.controller.js'
import { LoginRateLimiterService } from './login-rate-limiter.service.js'
import { OAuthController } from './oauth/oauth.controller.js'
import { OAuthService } from './oauth/oauth.service.js'
import { OAuthAvatarRehostService } from './oauth/oauth-avatar-rehost.service.js'
import { OAuthClientService } from './oauth/oauth-client.service.js'
import { OAuthLoginTicketService } from './oauth/oauth-login-ticket.service.js'
import { OAuthStateService } from './oauth/oauth-state.service.js'
import { OAuthProviderFactory } from './oauth/providers/oauth-provider.factory.js'
import { OrgAclVersionService } from './org-acl-version.service.js'
import { OrganizationContextResolver } from './organization-context/organization-context-resolver.service.js'
import { PermissionsCacheService } from './permissions-cache.service.js'
import { PrivilegedAdmissionService } from './privileged-admission.service.js'
import { PrivilegedRoleService } from './privileged-role.service.js'
import { SessionService } from './session.service.js'
import { JwtStrategy } from './strategies/jwt.strategy.js'
import { TokenService } from './token.service.js'
import { TokenManagerService } from './token-manager.service.js'
import { UserCacheService } from './user-cache.service.js'

@Module({
  imports: [
    FrontendContextModule,
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
    OAuthAvatarRehostService,
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
