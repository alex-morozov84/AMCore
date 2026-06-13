import {
  Body,
  Controller,
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
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { AuthErrorCode, AuthType, type OAuthExchangeResponse } from '@amcore/shared'

import { AppException, NotFoundException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { Auth } from '../decorators/auth.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import { OAuthExchangeDto } from '../dto'
import { OriginCheckGuard } from '../guards'
import { SessionService } from '../session.service'
import { TokenService } from '../token.service'

import { parseAppleUserName } from './apple-user'
import { OAuthService } from './oauth.service'
import {
  clearOAuthBindingCookie,
  isFormPostProvider,
  readOAuthBindingNonce,
  setOAuthBindingCookie,
} from './oauth-binding-cookie'
import { OAuthLoginTicketService } from './oauth-login-ticket.service'
import { OAuthProviderFactory } from './providers/oauth-provider.factory'

interface ProvidersResponse {
  providers: string[]
}

@ApiTags('oauth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly ticketService: OAuthLoginTicketService,
    private readonly providerFactory: OAuthProviderFactory,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly env: EnvService
  ) {}

  private get isProduction(): boolean {
    return this.env.get('NODE_ENV') === 'production'
  }

  @Get('providers')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'List configured OAuth providers' })
  getProviders(): ProvidersResponse {
    return { providers: this.providerFactory.getAvailableProviders() }
  }

  @Get(':provider')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Redirect to OAuth provider for login' })
  async authorize(@Param('provider') provider: string, @Res() res: Response): Promise<void> {
    const { url, browserNonce } = await this.oauthService.getAuthorizationURL(provider)
    setOAuthBindingCookie(res, provider, browserNonce, this.isProduction)
    res.redirect(url)
  }

  @Get(':provider/link')
  @Auth(AuthType.Bearer)
  @ApiOperation({ summary: 'Redirect to OAuth provider to link account' })
  async link(
    @Param('provider') provider: string,
    @CurrentUser('sub') userId: string,
    @Res() res: Response
  ): Promise<void> {
    const { url, browserNonce } = await this.oauthService.getLinkAuthorizationURL(provider, userId)
    setOAuthBindingCookie(res, provider, browserNonce, this.isProduction)
    res.redirect(url)
  }

  /**
   * Redirect/query providers (Google, GitHub, …) return via a top-level GET.
   * Apple is form_post-only and must not be accepted here — reject it before any
   * state/provider-code consumption so the GET transport stays exact.
   */
  @Get(':provider/callback')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Handle OAuth provider callback (redirect/query providers)' })
  async callbackGet(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    if (isFormPostProvider(provider)) throw new NotFoundException('OAuth callback')
    await this.processCallback(provider, code, state, req, res)
  }

  /**
   * Apple uses `response_mode=form_post` — it POSTs `code`/`state` (plus a
   * `user` JSON with the display name on the FIRST authorization only) as a
   * cross-site `application/x-www-form-urlencoded` body. Browser binding for
   * this path rides the `SameSite=None` Apple cookie (see `oauth-binding-cookie.ts`).
   *
   * Fail closed for any non-form_post provider: a redirect provider posted here
   * would otherwise have Apple-only `user` form data applied to it. The
   * provider check runs BEFORE `user` is parsed or any state is consumed.
   */
  @Post(':provider/callback')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Handle OAuth provider form_post callback (Apple)' })
  async callbackPost(
    @Param('provider') provider: string,
    @Body('code') code: string,
    @Body('state') state: string,
    @Body('user') user: string | undefined,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    if (!isFormPostProvider(provider)) throw new NotFoundException('OAuth callback')
    await this.processCallback(provider, code, state, req, res, parseAppleUserName(user))
  }

  private async processCallback(
    provider: string,
    code: string,
    state: string,
    req: Request,
    res: Response,
    firstLoginName?: string | null
  ): Promise<void> {
    if (!code || !state) {
      throw new AppException(
        'Missing code or state parameter',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_STATE_INVALID
      )
    }

    const browserNonce = readOAuthBindingNonce(req, provider)
    const result = await this.oauthService.handleCallback(
      provider,
      code,
      state,
      browserNonce,
      {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
      },
      firstLoginName
    )

    // One-time binding nonce: clear it once the callback succeeds.
    clearOAuthBindingCookie(res, provider)

    const frontendUrl = this.env.get('FRONTEND_URL')

    if (result.mode === 'login') {
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: this.env.get('NODE_ENV') === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      })

      const ticket = await this.ticketService.issue({
        userId: result.accessClaims.sub,
        email: result.accessClaims.email,
        systemRole: result.accessClaims.systemRole,
        sessionId: result.sessionId,
      })

      res.redirect(`${frontendUrl}/auth/callback?ticket=${ticket}`)
    } else {
      res.redirect(`${frontendUrl}/settings/linked-accounts?linked=${provider}`)
    }
  }

  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @Auth(AuthType.None)
  @UseGuards(OriginCheckGuard)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Exchange OAuth login ticket for access token' })
  async exchange(
    @Body() dto: OAuthExchangeDto,
    @Req() req: Request
  ): Promise<OAuthExchangeResponse> {
    const refreshToken = req.cookies?.refresh_token
    if (!refreshToken) {
      throw this.invalidExchange()
    }

    let session: Awaited<ReturnType<SessionService['validateRefreshToken']>>
    try {
      const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken)
      session = await this.sessionService.validateRefreshToken(refreshTokenHash)
    } catch {
      throw this.invalidExchange()
    }

    const claims = await this.ticketService.consume(dto.ticket)
    if (!claims) {
      throw this.invalidExchange()
    }

    if (session.id !== claims.sessionId || session.userId !== claims.userId) {
      throw this.invalidExchange()
    }

    const accessToken = this.tokenService.generateAccessToken({
      sub: claims.userId,
      email: claims.email,
      systemRole: claims.systemRole,
      // The validated session this ticket belongs to — carries `sid` for
      // OB-06b step-up freshness (session.id === claims.sessionId, asserted above).
      sid: claims.sessionId,
    })

    return { accessToken }
  }

  private invalidExchange(): AppException {
    return new AppException(
      'Invalid OAuth exchange',
      HttpStatus.UNAUTHORIZED,
      AuthErrorCode.OAUTH_TICKET_INVALID
    )
  }
}
