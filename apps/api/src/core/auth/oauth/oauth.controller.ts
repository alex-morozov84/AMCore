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
} from '@nestjs/common'
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { AuthErrorCode, AuthType, type OAuthExchangeResponse } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { Auth } from '../decorators/auth.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'
import { OAuthExchangeDto } from '../dto'
import { SessionService } from '../session.service'
import { TokenService } from '../token.service'

import { OAuthService } from './oauth.service'
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
    const { url } = await this.oauthService.getAuthorizationURL(provider)
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
    const { url } = await this.oauthService.getLinkAuthorizationURL(provider, userId)
    res.redirect(url)
  }

  @Get(':provider/callback')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Handle OAuth provider callback' })
  async callback(
    @Param('provider') provider: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    if (!code || !state) {
      throw new AppException(
        'Missing code or state parameter',
        HttpStatus.BAD_REQUEST,
        AuthErrorCode.OAUTH_STATE_INVALID
      )
    }

    const result = await this.oauthService.handleCallback(provider, code, state, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    })

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
