import { Controller, Get, HttpStatus, Param, Query, Req, Res } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { AuthErrorCode, AuthType } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import { EnvService } from '../../../env/env.service'
import { Auth } from '../decorators/auth.decorator'
import { CurrentUser } from '../decorators/current-user.decorator'

import { OAuthService } from './oauth.service'
import { OAuthProviderFactory } from './providers/oauth-provider.factory'

interface ProvidersResponse {
  providers: string[]
}

@ApiTags('oauth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauthService: OAuthService,
    private readonly providerFactory: OAuthProviderFactory,
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
      res.redirect(`${frontendUrl}/auth/callback?token=${result.accessToken}`)
    } else {
      res.redirect(`${frontendUrl}/settings/linked-accounts?linked=${provider}`)
    }
  }
}
