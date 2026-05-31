import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import type { User } from '@prisma/client'
import type { Request, Response } from 'express'
import { ZodSerializerDto } from 'nestjs-zod'

import {
  AuthType,
  PAGINATION,
  type RequestPrincipal,
  type SessionsListResponse,
  type UserResponse as SharedUserResponse,
} from '@amcore/shared'

import { PaginationQueryDto } from '../../common/dto/pagination-query.dto'
import { EnvService } from '../../env/env.service'

import { AuthService } from './auth.service'
import { Auth } from './decorators/auth.decorator'
import { CurrentUser } from './decorators/current-user.decorator'
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  StepUpDto,
  VerifyEmailDto,
} from './dto'
import { SessionsListResponseDto } from './dto/sessions-list-response.dto'
import { RefreshTokenGuard } from './guards'
import { SessionService } from './session.service'
import { TokenService } from './token.service'

interface AuthResponse {
  user: SharedUserResponse
  accessToken: string
}

interface AcceptedResponse {
  message: string
}

interface TokenResponse {
  accessToken: string
}

interface ProfileResponse {
  user: SharedUserResponse | null
}

// Sessions wire shape lives in `@amcore/shared`
// (`sessionsListResponseSchema`). Local interface removed in OB-05.

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly env: EnvService
  ) {}

  private get cookieOptions(): {
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
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    }
  }

  @Post('register')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Register new user' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponse> {
    const result = await this.authService.register(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })

    res.cookie('refresh_token', result.refreshToken, this.cookieOptions)

    return {
      user: result.user,
      accessToken: result.accessToken,
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Login user' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })

    res.cookie('refresh_token', result.refreshToken, this.cookieOptions)

    return {
      user: result.user,
      accessToken: result.accessToken,
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.None)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const refreshToken = req.cookies?.refresh_token

    if (refreshToken) {
      const hashedToken = this.tokenService.hashRefreshToken(refreshToken)
      await this.authService.logout(hashedToken)
    }

    res.clearCookie('refresh_token', { path: '/' })
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Auth(AuthType.None)
  @UseGuards(RefreshTokenGuard)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<TokenResponse> {
    const { user, refreshTokenHash } = req.user as unknown as {
      user: User
      refreshTokenHash: string
    }

    // Rotate refresh token; the new session id becomes the access token `sid`.
    const { refreshToken: newRefreshToken, sessionId } =
      await this.sessionService.rotateRefreshToken(refreshTokenHash, {
        userId: user.id,
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      })

    // Generate new access token with current system role (org context not preserved — use /switch).
    // `sid` points at the rotated session, which carried `lastAuthAt` forward
    // (refresh preserves step-up freshness but never renews it — OB-06b).
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
      systemRole: user.systemRole,
      sid: sessionId,
    })

    res.cookie('refresh_token', newRefreshToken, this.cookieOptions)

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
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: RequestPrincipal): Promise<ProfileResponse> {
    const profile = await this.authService.getUserById(user.sub)
    return { user: profile }
  }

  /**
   * Step-up re-authentication (OB-06b / ADR-037). Bearer-only: the caller
   * re-enters their password to refresh the current session's recent-auth
   * window, so they can perform destructive admin operations guarded by
   * `@RequireFreshAuth`. No new session, no refresh-token rotation. `req.ip`
   * is threaded through for the shared login brute-force limiter.
   */
  @Post('step-up')
  @HttpCode(HttpStatus.OK)
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Re-verify password to refresh step-up freshness' })
  async stepUp(
    @CurrentUser() principal: RequestPrincipal,
    @Body() dto: StepUpDto,
    @Req() req: Request
  ): Promise<TokenResponse> {
    return this.authService.stepUp(principal, dto.password, req.ip ?? '')
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
  @ZodSerializerDto(SessionsListResponseDto)
  async sessions(
    @CurrentUser('sub') userId: string,
    @Req() req: Request,
    @Query() pagination: PaginationQueryDto
  ): Promise<SessionsListResponse> {
    const refreshToken = req.cookies?.refresh_token
    const currentHash = refreshToken ? this.tokenService.hashRefreshToken(refreshToken) : undefined

    return this.sessionService.getUserSessions(
      userId,
      currentHash,
      pagination.page,
      pagination.limit
    )
  }

  @Delete('sessions/:sessionId')
  @Auth(AuthType.Bearer)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke specific session' })
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
  async revokeOtherSessions(
    @CurrentUser('sub') userId: string,
    @Req() req: Request
  ): Promise<void> {
    const refreshToken = req.cookies?.refresh_token

    if (!refreshToken) return

    const currentHash = this.tokenService.hashRefreshToken(refreshToken)
    await this.sessionService.deleteOtherSessions(userId, currentHash)
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Request password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<AcceptedResponse> {
    await this.authService.forgotPassword(dto.email)
    // Always return the same message to prevent account enumeration
    return { message: 'If an account with that email exists, a password reset link has been sent.' }
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Reset password using token from email' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password)
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Verify email address using token from email' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.authService.verifyEmail(dto.token)
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Resend email verification link' })
  async resendVerification(@Body() dto: ResendVerificationDto): Promise<AcceptedResponse> {
    await this.authService.resendVerificationEmail(dto.email)
    // Always return the same message to prevent account enumeration
    return {
      message: 'If the account exists and is unverified, a verification link has been sent.',
    }
  }
}
