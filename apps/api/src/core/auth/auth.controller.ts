import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-fastify'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiNoContentResponse,
  ApiOperation,
  ApiQuery,
  ApiSecurity,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import type { FastifyReply } from 'fastify'

import {
  AuthType,
  type AvatarResponse,
  coerceSupportedLocale,
  type MessageResponse,
  PAGINATION,
  type PasswordLoginPending,
  type PasswordLoginResponse,
  type ProfileResponse,
  type RefreshResponse,
  type RequestPrincipal,
  type SessionsListResponse,
  type StepUpResponse,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js'
import { ApiProtectionUnavailable, AppException } from '../../common/exceptions/index.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { SchemaResponses } from '../../common/schemas/schema-responses.js'
import {
  resolveSessionIpAddress,
  resolveVerifiedVisitorIp,
} from '../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../env/env.service.js'
import type { User } from '../../generated/prisma/client.js'
import { AVATAR_VALIDATION, FileValidationPipe } from '../../infrastructure/storage/index.js'
import { RATE_LIMIT_POLICIES, RateLimit } from '../../infrastructure/throttling/index.js'
import { browserSessionContext } from '../frontend-context/browser-session-context.service.js'
import { ApiFrontendContext } from '../frontend-context/frontend-context.openapi.js'
import { browserFrontendContext } from '../frontend-context/frontend-context.service.js'
import { invitationHandoffProof } from '../invitations/invitation-auth-handoff.js'

import { AuthService } from './auth.service.js'
import { AvatarService, type AvatarUploadFile } from './avatar.service.js'
import { Auth } from './decorators/auth.decorator.js'
import { CurrentUser } from './decorators/current-user.decorator.js'
import {
  AvatarResponseDto,
  ForgotPasswordDto,
  LoginDto,
  MessageResponseDto,
  PasswordLoginPendingDto,
  PasswordLoginResponseDto,
  ProfileResponseDto,
  RefreshResponseDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  SignupPolicyResponseDto,
  StepUpDto,
  StepUpPendingDto,
  UpdateProfileDto,
  VerifyEmailDto,
} from './dto/index.js'
import { SessionsListResponseDto } from './dto/sessions-list-response.dto.js'
import { OriginCheckGuard, RefreshTokenGuard } from './guards/index.js'
import { negotiateLocale } from './locale-negotiation.js'
import { parseBrowserReturnProof } from './mfa/browser-return-transition.js'
import { ApiRegistrationPublication } from './mfa/mfa-registration.openapi.js'
import { registrationBrowserIntent } from './mfa/mfa-registration-publication.js'
import { PasswordLoginService } from './password-login.service.js'
import { SessionService } from './session.service.js'
import { TokenService } from './token.service.js'

// Multipart hard stop for the avatar upload. Set above AVATAR_VALIDATION.maxSize
// (2 MB) so the FileValidationPipe produces the clean 413 for files between the
// preset limit and this cap; this cap is the absolute anti-DoS backstop.
const AVATAR_UPLOAD_HARD_LIMIT_BYTES = 6 * 1024 * 1024

// Sessions wire shape lives in `@amcore/shared`
// (`sessionsListResponseSchema`). Local interface removed in OB-05.

@ApiFrontendContext()
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly avatarService: AvatarService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly env: EnvService,
    private readonly passwordLogin: PasswordLoginService
  ) {}

  private cookieOptions(res: Response | FastifyReply): {
    httpOnly: boolean
    secure: boolean
    sameSite: 'strict'
    path: string
    maxAge: number
  } {
    return {
      httpOnly: true,
      secure: this.env.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * ('raw' in res ? 1 : 1000), // Native cookies use seconds.
    }
  }

  @Get('signup-policy')
  @Auth(AuthType.None)
  @ApiOperation({
    summary:
      'Read the public signup policy; invitation/account authorization remains server-enforced',
  })
  @SchemaResponse({ type: SignupPolicyResponseDto, status: 200 })
  signupPolicy(): { publicSignupEnabled: boolean } {
    return { publicSignupEnabled: this.env.get('AUTH_PUBLIC_SIGNUP_ENABLED') }
  }

  @Post('register')
  @ApiRegistrationPublication()
  @Auth(AuthType.None)
  @ApiHeader({ name: 'X-Invitation-Auth-Attempt-Id', required: false })
  @ApiHeader({ name: 'X-Invitation-Handoff-Key', required: false })
  @ApiHeader({ name: 'X-Invitation-Continuation', required: false })
  @ApiOperation({
    summary:
      'Register under public signup policy; scoped handoff uses the fixed matching invitation email',
    description:
      'The user, its first session and its email-verification token are created in one database transaction; if it fails, its writes roll back. After the commit the response can still be lost: sign in or reset the password instead of submitting again. A canonical-email conflict returns 409 EMAIL_ALREADY_EXISTS. The welcome email is queued best-effort without resend; the verification email is sent directly and can be resent.',
  })
  @SchemaResponse({
    type: PasswordLoginResponseDto,
    status: 201,
    description: 'User registered; browser credentials await exact publication',
  })
  async register(
    @Body({ schema: RegisterDto.schema }) dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<PasswordLoginResponse> {
    const result = await this.authService.register(dto, {
      registrationBrowser: registrationBrowserIntent(req),
      frontend: browserFrontendContext(req),
      userAgent: req.headers['user-agent'],
      ipAddress: resolveSessionIpAddress(req, this.env),
      acceptedLocale: negotiateLocale(req),
      handoff: invitationHandoffProof(
        req.headers['x-invitation-auth-attempt-id'],
        req.headers['x-invitation-handoff-key']
      ),
      invitationCredential:
        typeof req.headers['x-invitation-continuation'] === 'string'
          ? req.headers['x-invitation-continuation']
          : undefined,
    })

    res.cookie('refresh_token', result.refreshToken, this.cookieOptions(res))

    return {
      user: result.user,
      accessToken: result.accessToken,
      ...(result.publication ? { publication: result.publication } : {}),
    }
  }

  @Post('login')
  @ApiHeader({
    name: 'X-Amcore-Return-Proof',
    required: false,
    description: 'Private BFF logout-receipt link; presentation only, never a login proof',
  })
  @Auth(AuthType.None)
  @ApiHeader({
    name: 'X-Invitation-Auth-Attempt-Id',
    required: false,
    description: 'Paired with handoff key and continuation for scoped server auth',
  })
  @ApiHeader({ name: 'X-Invitation-Handoff-Key', required: false })
  @ApiHeader({ name: 'X-Invitation-Continuation', required: false })
  @ApiOperation({
    summary: 'Login user; optional scoped invitation handoff requires explicit confirmation',
  })
  @SchemaResponses(
    {
      type: PasswordLoginResponseDto,
      status: 200,
      description: 'Credentials issued; browser publication must still settle before use',
    },
    {
      type: PasswordLoginPendingDto,
      status: 202,
      description: 'Restricted MFA continuation; no access or refresh credential',
    }
  )
  @ApiTooManyRequestsResponse({
    description: 'Password attempt limit reached; Retry-After is 900 or 86400 seconds',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Login protection unavailable; no new session or step-up refresh is issued. A sent counter update may already have executed.',
  })
  async login(
    @Body({ schema: LoginDto.schema }) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<PasswordLoginResponse | PasswordLoginPending> {
    const handoff = invitationHandoffProof(
      req.headers['x-invitation-auth-attempt-id'],
      req.headers['x-invitation-handoff-key']
    )
    const invitationCredential = req.headers['x-invitation-continuation']
    if (handoff ? typeof invitationCredential !== 'string' : invitationCredential !== undefined)
      throw new AppException('Invalid invitation login scope', 401, 'AUTH_HANDOFF_INVALID')
    const browser = browserSessionContext(req)
    const returnProof = parseBrowserReturnProof(req.headers['x-amcore-return-proof'])
    if (returnProof && (!browser?.binding || handoff))
      throw new AppException(
        'Return metadata requires its own browser entry',
        403,
        'AUTH_ORIGIN_REJECTED'
      )
    if (browser && !browser.binding)
      throw new AppException(
        'Browser bootstrap required before sign-in',
        401,
        'AUTH_CONTEXT_CHANGED'
      )
    const result = await this.passwordLogin.begin(dto, {
      ...(handoff && typeof invitationCredential === 'string'
        ? {
            invited: {
              handoff,
              credential: invitationCredential,
              frontend: browserFrontendContext(req),
            },
          }
        : {}),
      userAgent: req.headers['user-agent'],
      source: resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? '',
      ipAddress: resolveSessionIpAddress(req, this.env),
      frame: browser
        ? { kind: 'browser', binding: browser.binding!, returnProof }
        : { kind: 'direct' },
    })
    if (result.kind === 'pending') {
      res.status(202)
      return result.body
    }
    res.cookie('refresh_token', result.refreshToken, this.cookieOptions(res))
    return result.body
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.None)
  @UseGuards(OriginCheckGuard)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Logout user' })
  @ApiNoContentResponse({ description: 'Logged out' })
  @ApiConflictResponse({
    description:
      'SESSION_CHANGED: browser generation or selected family changed; no fallback logout',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken = req.cookies?.refresh_token
    const transport = browserSessionContext(req)
    const browser = transport?.binding
    if (transport && !browser)
      throw new AppException('Browser context required', 401, 'AUTH_CONTEXT_CHANGED')
    if (browser) {
      await this.sessionService.logoutBrowser(
        browser,
        refreshToken ? this.tokenService.hashRefreshToken(refreshToken) : undefined
      )
    } else if (refreshToken) {
      const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
      await this.authService.logout(hashedToken)
    }

    res.clearCookie('refresh_token', { path: '/' })
  }

  @Post('refresh')
  @Auth(AuthType.None)
  @UseGuards(OriginCheckGuard, RefreshTokenGuard)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Refresh access token' })
  @SchemaResponse({ type: RefreshResponseDto, status: 200, description: 'Access token refreshed' })
  @ApiConflictResponse({
    description: 'SESSION_CHANGED: current family, account version or browser binding changed',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<RefreshResponse> {
    const { user, refreshTokenHash } = req.user as unknown as {
      user: User
      refreshTokenHash: string
    }

    // Rotate refresh token; the new session id becomes the access token `sid`.
    const {
      refreshToken: newRefreshToken,
      accessClaims,
      accessToken: issuedAccessToken,
    } = await this.sessionService.rotateRefreshToken(
      refreshTokenHash,
      {
        userId: user.id,
        userAgent: req.headers['user-agent'],
        ipAddress: resolveSessionIpAddress(req, this.env),
      },
      browserSessionContext(req)?.binding ?? null
    )

    // Issuance uses the current owner/family read under the rotation locks, never the earlier guard snapshot.
    const accessToken = issuedAccessToken ?? this.tokenService.generateAccessToken(accessClaims)

    res.cookie('refresh_token', newRefreshToken, this.cookieOptions(res))

    return { accessToken }
  }

  /**
   * `/auth/me` deliberately accepts both JWT and API key — it's the
   * single identity self-check endpoint that integrations can call to
   * verify their credential is well-formed and to introspect their
   * effective user identity. See API_KEYS_REVIEW.md AK-01 for the
   * original deliberate decision. The explicit annotation is a
   * registered ADR-034 allowlist entry (per `auth-decorator-coverage.spec.ts`);
   * the runtime default after Stage 1c is `[AuthType.Bearer]`, so this
   * explicit `@Auth(Bearer, ApiKey)` is what makes the route
   * dual-auth.
   */
  @Get('me')
  @Auth(AuthType.Bearer, AuthType.ApiKey)
  @ApiBearerAuth()
  @ApiSecurity('apiKeyBearer')
  @ApiProtectionUnavailable('API key')
  @ApiOperation({ summary: 'Get current user profile' })
  @SchemaResponse({ type: ProfileResponseDto, status: 200, description: 'Current user profile' })
  async me(@CurrentUser() user: RequestPrincipal): Promise<ProfileResponse> {
    const profile = await this.authService.getUserById(user.sub)
    return { user: profile }
  }

  /**
   * Partial self-profile update. Bearer-only (unlike `GET /me`, which is also
   * API-key readable): mutating a user's own name/locale/timezone is an
   * interactive action, not something an integration credential should perform.
   * Only the supplied fields change.
   */
  @Patch('me')
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  @SchemaResponse({ type: ProfileResponseDto, status: 200, description: 'Updated user profile' })
  async updateProfile(
    @CurrentUser('sub') userId: string,
    @Body({ schema: UpdateProfileDto.schema }) dto: UpdateProfileDto
  ): Promise<ProfileResponse> {
    const user = await this.authService.updateProfile(userId, dto)
    return { user }
  }

  @Post('me/avatar')
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  // Per-handler throttle (F12): avatar upload runs synchronous sharp decoding of
  // up to MEDIA_AVATAR_MAX_PIXELS, so narrow the global `long` bucket (100/min)
  // to 5/min/IP for this heavy, rarely-repeated action. Mirrors the OB-03 admin
  // throttle pattern.
  @RateLimit(RATE_LIMIT_POLICIES.EXPENSIVE_ACTION)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: AVATAR_UPLOAD_HARD_LIMIT_BYTES },
    })
  )
  @ApiOperation({ summary: 'Upload current user avatar' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @SchemaResponse({ type: AvatarResponseDto, status: 201, description: 'Avatar stored' })
  async uploadAvatar(
    @CurrentUser('sub') userId: string,
    @UploadedFile(new FileValidationPipe(AVATAR_VALIDATION)) file: AvatarUploadFile
  ): Promise<AvatarResponse> {
    const avatarUrl = await this.avatarService.setAvatar(userId, file)
    return { avatarUrl }
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete current user avatar' })
  @ApiNoContentResponse({ description: 'Avatar removed' })
  async deleteAvatar(@CurrentUser('sub') userId: string): Promise<void> {
    await this.avatarService.removeAvatar(userId)
  }

  /**
   * Step-up re-authentication (OB-06b / ADR-037). Bearer-only: the caller
   * re-enters their password to refresh the current session's recent-auth
   * window, so they can perform destructive admin operations guarded by
   * `@RequireFreshAuth`. No new session, no refresh-token rotation. The peer-verified visitor address, with req.ip/socket fallback,
   * selects the shared password limiter identity.
   */
  @Post('step-up')
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Re-verify password to refresh step-up freshness' })
  @SchemaResponses(
    {
      type: RefreshResponseDto,
      status: 200,
      description: 'Same-family step-up token issued; all required proofs are fresh',
    },
    {
      type: StepUpPendingDto,
      status: 202,
      description: 'Password verified; listed proofs are still required. No credentials issued',
    }
  )
  @ApiConflictResponse({
    description: 'SESSION_CHANGED: original family, account version or browser binding changed',
  })
  @ApiTooManyRequestsResponse({
    description: 'Password attempt limit reached; Retry-After is 900 or 86400 seconds',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Login protection unavailable; no new session or step-up refresh is issued. A sent counter update may already have executed.',
  })
  async stepUp(
    @CurrentUser() principal: RequestPrincipal,
    @Body({ schema: StepUpDto.schema }) dto: StepUpDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<StepUpResponse> {
    const result = await this.authService.stepUp(
      principal,
      dto.password,
      resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? ''
    )
    if ('kind' in result) res.status(HttpStatus.ACCEPTED)
    return result
  }

  // Session-management routes are bearer-only — API keys must not be able to
  // enumerate or revoke interactive browser sessions. Listing sessions exposes
  // user-agent / IP-derived metadata (recon surface); revoking sessions from a
  // leaked low-scope API key would let an attacker evict the legitimate user.
  // See `ai/API_KEYS_REVIEW.md` AK-01.
  @Get('sessions')
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active sessions' })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    minimum: 1,
    example: PAGINATION.DEFAULT_PAGE,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: PAGINATION.MAX_LIMIT,
    example: PAGINATION.DEFAULT_LIMIT,
  })
  @ApiHeader({
    name: 'accept-language',
    required: false,
    description:
      "Display locale for each session's approximate-location city name ('en'/'ru'); " +
      'unsupported or absent falls back to en. Never used for authorization.',
  })
  @SchemaResponse({ type: SessionsListResponseDto, status: 200, description: 'Active sessions' })
  async sessions(
    @CurrentUser('sub') userId: string,
    @Req() req: Request,
    @Query({ schema: PaginationQueryDto.schema }) pagination: PaginationQueryDto,
    @Headers('accept-language') acceptLanguage: string | undefined
  ): Promise<SessionsListResponse> {
    const refreshToken = req.cookies?.refresh_token
    const currentHash = refreshToken ? this.tokenService.hashRefreshToken(refreshToken) : undefined

    return this.sessionService.getUserSessions(
      userId,
      currentHash,
      pagination.page,
      pagination.limit,
      coerceSupportedLocale(acceptLanguage)
    )
  }

  @Delete('sessions/:sessionId')
  @Auth(AuthType.Bearer)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke specific session' })
  @ApiNoContentResponse({ description: 'Session revoked' })
  async revokeSession(
    @CurrentUser('sub') userId: string,
    @Param('sessionId') sessionId: string
  ): Promise<void> {
    await this.sessionService.deleteSession(sessionId, userId)
  }

  @Delete('sessions')
  @Auth(AuthType.Bearer)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions except current' })
  @ApiNoContentResponse({ description: 'Other sessions revoked' })
  @ApiConflictResponse({
    description:
      'SESSION_CHANGED: the retained refresh family is no longer current or belongs to another user',
  })
  async revokeOtherSessions(
    @CurrentUser('sub') userId: string,
    @Req() req: Request
  ): Promise<void> {
    const refreshToken = req.cookies?.refresh_token

    if (!refreshToken) return

    const currentHash = this.tokenService.hashRefreshToken(refreshToken)
    await this.sessionService.deleteOtherSessions(
      userId,
      currentHash,
      browserSessionContext(req)?.binding ?? null
    )
  }

  @Post('forgot-password')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Request password reset email' })
  @SchemaResponse({ type: MessageResponseDto, status: 200, description: 'Reset email dispatched' })
  async forgotPassword(
    @Body({ schema: ForgotPasswordDto.schema }) dto: ForgotPasswordDto,
    @Req() req?: Request
  ): Promise<MessageResponse> {
    await this.authService.forgotPassword(dto.email, browserFrontendContext(req))
    // Always return the same message to prevent account enumeration
    return { message: 'If an account with that email exists, a password reset link has been sent.' }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiNoContentResponse({ description: 'Password reset' })
  async resetPassword(
    @Body({ schema: ResetPasswordDto.schema }) dto: ResetPasswordDto,
    @Req() req?: Request
  ): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password, browserFrontendContext(req))
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Verify email address using token from email' })
  @ApiNoContentResponse({ description: 'Email verified' })
  async verifyEmail(
    @Body({ schema: VerifyEmailDto.schema }) dto: VerifyEmailDto,
    @Req() req?: Request
  ): Promise<void> {
    await this.authService.verifyEmail(dto.token, browserFrontendContext(req))
  }

  @Post('resend-verification')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Resend email verification link' })
  @SchemaResponse({
    type: MessageResponseDto,
    status: 200,
    description: 'Verification email dispatched',
  })
  async resendVerification(
    @Body({ schema: ResendVerificationDto.schema }) dto: ResendVerificationDto,
    @Req() req?: Request
  ): Promise<MessageResponse> {
    await this.authService.resendVerificationEmail(dto.email, browserFrontendContext(req))
    // Always return the same message to prevent account enumeration
    return {
      message: 'If the account exists and is unverified, a verification link has been sent.',
    }
  }
}
