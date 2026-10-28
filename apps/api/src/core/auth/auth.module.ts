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
import { AuthMailModule } from './auth-mail.module.js'
import { AvatarService } from './avatar.service.js'
import { BrowserPublicationsController } from './browser-publications.controller.js'
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
import { InvitationPublicationController } from './invitation-publication.controller.js'
import { LoginRateLimiterService } from './login-rate-limiter.service.js'
import { BrowserPublicationGuard } from './mfa/browser-publication.guard.js'
import { BrowserPublicationService } from './mfa/browser-publication.service.js'
import { MfaAuthorityReader } from './mfa/mfa-authority-reader.service.js'
import { MfaBackupRotationService } from './mfa/mfa-backup-rotation.service.js'
import { MfaContinuationGuard } from './mfa/mfa-continuation.guard.js'
import { MfaFactorBindingService } from './mfa/mfa-factor-binding.service.js'
import { MfaFamilyIssuanceService } from './mfa/mfa-family-issuance.service.js'
import { MfaFamilyReauthenticationService } from './mfa/mfa-family-reauthentication.service.js'
import { MfaFlowStatusService } from './mfa/mfa-flow-status.service.js'
import { MfaFlowVerificationService } from './mfa/mfa-flow-verification.service.js'
import { MfaFoundationModule } from './mfa/mfa-foundation.module.js'
import { MfaJwtAdmissionService } from './mfa/mfa-jwt-admission.service.js'
import { MfaLoginStartService } from './mfa/mfa-login-start.service.js'
import { MfaPasswordIdentityService } from './mfa/mfa-password-identity.service.js'
import { MfaPasswordVerificationService } from './mfa/mfa-password-verification.service.js'
import { MfaPublicationAcknowledgementService } from './mfa/mfa-publication-acknowledgement.service.js'
import { MfaSecurityEvents } from './mfa/mfa-security-events.service.js'
import { MfaSeedDraftService } from './mfa/mfa-seed-draft.service.js'
import { MfaSessionFlowService } from './mfa/mfa-session-flow.service.js'
import { MfaSetupAcknowledgementService } from './mfa/mfa-setup-acknowledgement.service.js'
import { MfaSetupCodeRecoveryService } from './mfa/mfa-setup-code-recovery.service.js'
import { MfaSourceLimiterService } from './mfa/mfa-source-limiter.service.js'
import { MfaTicketRedemptionService } from './mfa/mfa-ticket-redemption.service.js'
import { MfaEnrollmentController } from './mfa-enrollment.controller.js'
import { MfaLoginController } from './mfa-login.controller.js'
import { MfaPublicationController } from './mfa-publication.controller.js'
import { MfaSessionFlowController } from './mfa-session-flow.controller.js'
import { MfaSettingsController } from './mfa-settings.controller.js'
import { OAuthController } from './oauth/oauth.controller.js'
import { OAuthService } from './oauth/oauth.service.js'
import { OAuthAvatarRehostService } from './oauth/oauth-avatar-rehost.service.js'
import { OAuthClientService } from './oauth/oauth-client.service.js'
import { OAuthLoginTicketService } from './oauth/oauth-login-ticket.service.js'
import { OAuthStateService } from './oauth/oauth-state.service.js'
import { OAuthProviderFactory } from './oauth/providers/oauth-provider.factory.js'
import { OrgAclVersionService } from './org-acl-version.service.js'
import { OrganizationContextResolver } from './organization-context/organization-context-resolver.service.js'
import { PasswordLoginService } from './password-login.service.js'
import { PasswordStepUpService } from './password-step-up.service.js'
import { PermissionsCacheService } from './permissions-cache.service.js'
import { PrivilegedAdmissionService } from './privileged-admission.service.js'
import { PrivilegedRoleService } from './privileged-role.service.js'
import { SessionService } from './session.service.js'
import { JwtStrategy } from './strategies/jwt.strategy.js'
import { TokenService } from './token.service.js'
import { UserCacheService } from './user-cache.service.js'

@Module({
  imports: [
    MfaFoundationModule,
    FrontendContextModule,
    AuthMailModule,
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
  controllers: [
    AuthController,
    OAuthController,
    InvitationHandoffsController,
    BrowserPublicationsController,
    MfaLoginController,
    MfaEnrollmentController,
    MfaSessionFlowController,
    MfaSettingsController,
    MfaPublicationController,
    InvitationPublicationController,
  ],
  providers: [
    AuthService,
    PasswordLoginService,
    PasswordStepUpService,
    AvatarService,
    EmailIdentityService,
    LoginRateLimiterService,
    MfaAuthorityReader,
    BrowserPublicationService,
    BrowserPublicationGuard,
    MfaContinuationGuard,
    MfaBackupRotationService,
    MfaFactorBindingService,
    MfaFamilyIssuanceService,
    MfaFamilyReauthenticationService,
    MfaJwtAdmissionService,
    MfaLoginStartService,
    MfaPublicationAcknowledgementService,
    MfaPasswordIdentityService,
    MfaSeedDraftService,
    MfaSessionFlowService,
    MfaSetupAcknowledgementService,
    MfaSetupCodeRecoveryService,
    MfaFlowVerificationService,
    MfaFlowStatusService,
    MfaPasswordVerificationService,
    MfaSecurityEvents,
    MfaSourceLimiterService,
    MfaTicketRedemptionService,
    OAuthClientService,
    OAuthLoginTicketService,
    OAuthProviderFactory,
    OAuthAvatarRehostService,
    OAuthService,
    OAuthStateService,
    TokenService,
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
    PasswordStepUpService,
    UserCacheService,
    AbilityFactory,
    TokenService,
    EmailIdentityService,
    OrgAclVersionService,
    OrganizationContextResolver,
    OAuthProviderFactory,
  ],
})
export class AuthModule {}
