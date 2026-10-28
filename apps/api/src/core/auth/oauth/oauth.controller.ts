import { randomBytes } from 'node:crypto'

import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Request, Response } from 'express'
import { z } from 'zod'

import { frontendAuthPath, parseProductAdminReturn } from '@amcore/shared'
import {
  AuthErrorCode,
  AuthType,
  coerceSupportedLocale,
  invitationOAuthCorrelationSchema,
  localizedFrontendUrl,
  type OAuthExchangeResponse,
  oauthExchangeResponseSchema,
  type OAuthProvidersResponse,
  type PasswordLoginPending,
  type PasswordLoginResponse,
  passwordLoginResponseSchema,
  type RequestPrincipal,
} from '@amcore/shared'

import { AppException, NotFoundException } from '../../../common/exceptions/index.js'
import { createSchemaDto } from '../../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../../common/schemas/schema-response.js'
import { SchemaResponses } from '../../../common/schemas/schema-responses.js'
import {
  resolveSessionIpAddress,
  resolveVerifiedVisitorIp,
} from '../../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../../env/env.service.js'
import { browserSessionContext } from '../../frontend-context/browser-session-context.service.js'
import { ApiFrontendContext } from '../../frontend-context/frontend-context.openapi.js'
import { browserFrontendContext } from '../../frontend-context/frontend-context.service.js'
import { resolveFrontendPlacement } from '../../frontend-context/frontend-placement.js'
import { invitationHandoffProof } from '../../invitations/invitation-auth-handoff.js'
import { invalidInvitation } from '../../invitations/invitation-locks.js'
import { Auth } from '../decorators/auth.decorator.js'
import { CurrentUser } from '../decorators/current-user.decorator.js'
import { PasswordLoginPendingDto } from '../dto/index.js'
import { OAuthExchangeDto, OAuthProvidersResponseDto } from '../dto/index.js'
import { OriginCheckGuard } from '../guards/index.js'
import { negotiateLocale } from '../locale-negotiation.js'
import { storedInvitationIntentSchema } from '../mfa/mfa-invitation-intent.js'
import { oauthIdentitySnapshotSchema } from '../mfa/mfa-login-start.service.js'
import { PasswordLoginService } from '../password-login.service.js'
import { capturePasswordStepUp } from '../password-step-up-authority.js'
import { SessionService } from '../session.service.js'
import { TokenService } from '../token.service.js'

import { parseAppleUserName } from './apple-user.js'
import { OAuthService } from './oauth.service.js'
import {
  clearOAuthBindingCookie,
  isFormPostProvider,
  readOAuthBindingNonce,
  setOAuthBindingCookie,
} from './oauth-binding-cookie.js'
import { OAuthLoginTicketService } from './oauth-login-ticket.service.js'
import { OAuthProviderFactory } from './providers/oauth-provider.factory.js'

const OAuthCompleteResult = createSchemaDto(
  z.union([passwordLoginResponseSchema, oauthExchangeResponseSchema]),
  'OAuthCompleteResult'
)

@ApiFrontendContext()
@ApiTags('oauth')
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly login: PasswordLoginService,
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
  @SchemaResponse({
    type: OAuthProvidersResponseDto,
    status: 200,
    description: 'Configured providers',
  })
  getProviders(): OAuthProvidersResponse {
    return { providers: this.providerFactory.getAvailableProviders() }
  }

  @Get(':provider')
  @Auth(AuthType.None)
  @ApiHeader({ name: 'X-Invitation-Continuation', required: false })
  @ApiHeader({ name: 'X-Invitation-Attempt-Id', required: false })
  @ApiHeader({ name: 'X-Invitation-Auth-Attempt-Id', required: false })
  @ApiHeader({ name: 'X-Invitation-Handoff-Key', required: false })
  @ApiOperation({ summary: 'Start OAuth login with optional server-bound invitation correlation' })
  @ApiQuery({
    name: 'returnTo',
    required: false,
    type: String,
    description:
      'JSON-encoded finite product-admin destination. Only trusted frontend-bound state retains it; arbitrary URLs are not accepted.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to the provider authorization URL' })
  async authorize(
    @Param('provider') provider: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    // Seed a new OAuth user's locale from the browser's Accept-Language (D2);
    // carried in the one-time state and applied only on account creation.
    const { url, browserNonce } = await this.oauthService.getAuthorizationURL(
      provider,
      negotiateLocale(req),
      this.invitedStart(req),
      browserFrontendContext(req),
      parseProductAdminReturn(req.query.returnTo),
      this.browserAttempt(req)
    )
    setOAuthBindingCookie(
      res,
      provider,
      browserNonce,
      this.isProduction,
      undefined,
      browserFrontendContext(req)?.frontend
    )
    res.status(HttpStatus.FOUND).redirect(url)
  }

  @Get(':provider/link')
  @Auth(AuthType.Bearer)
  @ApiBearerAuth()
  @ApiForbiddenResponse({
    description: 'Protected linking requires fresh local password and second-factor proofs',
  })
  @ApiConflictResponse({
    description: 'Original family, security version or browser binding changed',
  })
  @ApiServiceUnavailableResponse({ description: 'Authority or one-time state storage unavailable' })
  @ApiOperation({
    summary: 'Start provider linking bound to the current source session; grant no new session',
    description:
      'Successful protected linking advances the security version and revokes prior sessions and continuations atomically. The callback redirects to sign-in without issuing replacement credentials.',
  })
  @ApiResponse({ status: 302, description: 'Redirect to the provider authorization URL' })
  async link(
    @Param('provider') provider: string,
    @CurrentUser() principal: RequestPrincipal,
    @Res() res: Response,
    @Req() req?: Request
  ): Promise<void> {
    const { url, browserNonce } = await this.oauthService.getLinkAuthorizationURL(
      provider,
      principal.sub,
      browserFrontendContext(req),
      capturePasswordStepUp(principal)
    )
    setOAuthBindingCookie(
      res,
      provider,
      browserNonce,
      this.isProduction,
      undefined,
      browserFrontendContext(req)?.frontend
    )
    res.status(HttpStatus.FOUND).redirect(url)
  }

  /**
   * Redirect/query providers (Google, GitHub, …) return via a top-level GET.
   * Apple is form_post-only and must not be accepted here — reject it before any
   * state/provider-code consumption so the GET transport stays exact.
   */
  @Get(':provider/callback')
  @Auth(AuthType.None)
  @ApiOperation({ summary: 'Handle OAuth provider callback (redirect/query providers)' })
  @ApiResponse({
    status: 302,
    description: 'Redirect to the frontend callback, linked-accounts page or required new sign-in',
  })
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
  @ApiResponse({
    status: 302,
    description: 'Redirect to the frontend callback, linked-accounts page or required new sign-in',
  })
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

    const frontend = browserFrontendContext(req)
    const browserNonce = readOAuthBindingNonce(req, provider, frontend?.frontend)
    const result = await this.oauthService.handleCallback(
      provider,
      code,
      state,
      browserNonce,
      {
        userAgent: req.headers['user-agent'],
        ipAddress: resolveSessionIpAddress(req, this.env),
      },
      firstLoginName,
      frontend
    )

    // One-time binding nonce: clear it once the callback succeeds.
    clearOAuthBindingCookie(res, provider, frontend?.frontend)

    // Locale-prefixed like every other server-generated link: the browser
    // arriving here may have no locale cookie yet (a fresh OAuth sign-in), so
    // the bare path would be resolved by Accept-Language instead of the
    // account's stored preference.
    const locale = coerceSupportedLocale(result.user.locale)

    if (result.mode === 'login_identity') {
      // This cookie proves the callback browser only. It is not stored as a Session or refresh credential.
      const binding = randomBytes(32).toString('hex')
      const ticket = await this.ticketService.issue({
        userId: result.identity.userId,
        email: result.user.email,
        systemRole: result.identity.systemRole,
        sessionId: '',
        ...(result.browserAttemptId ? { browserAttemptId: result.browserAttemptId } : {}),
        identity: result.identity,
        ...(result.invitationIntent ? { invitationIntent: result.invitationIntent } : {}),
        exchangeBindingHash: this.tokenService.hashRefreshToken(binding),
        ...(frontend
          ? {
              ...frontend,
              callbackUri: this.providerFactory.callbackUri(provider, frontend.frontend),
            }
          : {}),
        ...(result.returnTo ? { returnTo: result.returnTo } : {}),
      })
      res.cookie('refresh_token', binding, {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: 60000 * ('raw' in res ? 1 : 1000),
      })
      res
        .status(HttpStatus.FOUND)
        .redirect(
          localizedFrontendUrl(
            frontend?.frontend === 'admin'
              ? resolveFrontendPlacement(this.env).admin
              : this.env.get('FRONTEND_URL'),
            locale,
            frontendAuthPath(frontend?.frontend ?? 'site', '/auth/callback'),
            { ticket }
          )
        )
      return
    }

    if (result.mode === 'login') {
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: this.env.get('NODE_ENV') === 'production',
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * ('raw' in res ? 1 : 1000),
      })

      const ticket = await this.ticketService.issue({
        userId: result.accessClaims.sub,
        email: result.accessClaims.email,
        systemRole: result.accessClaims.systemRole,
        sessionId: result.sessionId,
        ...(frontend
          ? {
              ...frontend,
              callbackUri: this.providerFactory.callbackUri(provider, frontend.frontend),
            }
          : {}),
        ...(result.returnTo ? { returnTo: result.returnTo } : {}),
        ...(result.invitation ? { invitation: result.invitation } : {}),
      })

      res.status(HttpStatus.FOUND).redirect(
        localizedFrontendUrl(
          frontend?.frontend === 'admin'
            ? resolveFrontendPlacement(this.env).admin
            : this.env.get('FRONTEND_URL'),
          locale,
          frontendAuthPath(frontend?.frontend ?? 'site', '/auth/callback'),
          {
            ticket,
          }
        )
      )
    } else {
      res.status(HttpStatus.FOUND).redirect(
        localizedFrontendUrl(
          frontend?.frontend === 'admin'
            ? resolveFrontendPlacement(this.env).admin
            : this.env.get('FRONTEND_URL'),
          locale,
          result.reauthenticationRequired
            ? frontendAuthPath(frontend?.frontend ?? 'site', '/login')
            : frontend?.frontend === 'admin'
              ? frontendAuthPath('admin', '/auth/linked')
              : 'settings/linked-accounts',
          {
            linked: provider,
          }
        )
      )
    }
  }

  @Post('exchange')
  @Auth(AuthType.None)
  @UseGuards(OriginCheckGuard)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Exchange OAuth login ticket for access token' })
  @SchemaResponses(
    {
      type: OAuthCompleteResult,
      status: 200,
      description: 'Legacy invitation exchange pending combined publication integration',
    },
    {
      type: PasswordLoginPendingDto,
      status: 202,
      description:
        'Restricted OAuth identity continuation; protected accounts require local password and factor',
    }
  )
  async exchange(
    @Body({ schema: OAuthExchangeDto.schema }) dto: OAuthExchangeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<OAuthExchangeResponse | PasswordLoginResponse | PasswordLoginPending> {
    const refreshToken = req.cookies?.refresh_token
    if (!refreshToken) {
      throw this.invalidExchange()
    }

    const claims = await this.ticketService.consume(dto.ticket)
    if (!claims) {
      throw this.invalidExchange()
    }

    const frontend = browserFrontendContext(req)
    if (
      (claims.frontend ?? 'site') !== (frontend?.frontend ?? 'site') ||
      (claims.frontend &&
        (!frontend || claims.placementFingerprint !== frontend.placementFingerprint))
    )
      throw this.invalidExchange()

    if (claims.identity) {
      if (
        claims.invitation ||
        claims.sessionId ||
        claims.userId !== claims.identity.userId ||
        !claims.exchangeBindingHash ||
        this.tokenService.hashRefreshToken(refreshToken) !== claims.exchangeBindingHash
      )
        throw this.invalidExchange()
      const identity = oauthIdentitySnapshotSchema.safeParse(claims.identity)
      if (!identity.success) throw this.invalidExchange()
      const transport = browserSessionContext(req)
      if (claims.browserAttemptId !== this.browserAttempt(req)) throw this.invalidExchange()
      if (transport && !transport.binding) throw this.invalidExchange()
      const invitation = claims.invitationIntent
        ? storedInvitationIntentSchema.safeParse(claims.invitationIntent)
        : undefined
      if (invitation && (!invitation.success || !transport?.binding)) throw this.invalidExchange()
      const result = await this.login.beginOAuth(
        identity.data,
        {
          source:
            resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? '',
          frame: transport?.binding
            ? { kind: 'browser', binding: transport.binding }
            : { kind: 'direct' },
          userAgent: req.headers['user-agent'],
          ipAddress: resolveSessionIpAddress(req, this.env),
        },
        invitation?.success ? invitation.data : undefined
      )
      if (result.kind === 'pending') {
        res.status(202)
        return { ...result.body, ...(claims.returnTo ? { returnTo: claims.returnTo } : {}) }
      }
      res.status(200)
      res.cookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: this.isProduction,
        sameSite: 'strict',
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * ('raw' in res ? 1 : 1000),
      })
      return result.body
    }
    // Remaining legacy form is invitation-only, never an ordinary OAuth bypass.
    if (!claims.invitation) throw this.invalidExchange()
    let session: Awaited<ReturnType<SessionService['validateRefreshToken']>>
    try {
      const refreshTokenHash = this.tokenService.hashRefreshToken(refreshToken)
      session = await this.sessionService.validateRefreshToken(refreshTokenHash)
    } catch {
      throw this.invalidExchange()
    }

    if (session.id !== claims.sessionId || session.userId !== claims.userId) {
      throw this.invalidExchange()
    }

    if (claims.invitation) {
      const correlation = invitationOAuthCorrelationSchema.safeParse(claims.invitation)
      if (!correlation.success || correlation.data.backendSessionId !== session.id)
        throw this.invalidExchange()
      await this.sessionService.assertInvitationExchange(
        correlation.data.attemptId,
        session.id,
        claims.userId
      )
    }
    const accessToken = this.tokenService.generateAccessToken({
      sub: claims.userId,
      email: claims.email,
      systemRole: claims.systemRole,
      // The validated session this ticket belongs to — carries `sid` for
      // OB-06b step-up freshness (session.id === claims.sessionId, asserted above).
      sid: claims.sessionId,
    })

    return {
      accessToken,
      ...(claims.returnTo ? { returnTo: claims.returnTo } : {}),
      ...(claims.invitation ? { invitation: claims.invitation } : {}),
    }
  }

  private invitedStart(req: Request):
    | {
        handoff: NonNullable<ReturnType<typeof invitationHandoffProof>>
        credential: string
        attemptId: string
      }
    | undefined {
    const handoff = invitationHandoffProof(
      req.headers['x-invitation-auth-attempt-id'],
      req.headers['x-invitation-handoff-key']
    )
    const credential = req.headers['x-invitation-continuation']
    const attemptId = req.headers['x-invitation-attempt-id']
    if (!handoff && credential === undefined && attemptId === undefined) return undefined
    if (
      !handoff ||
      typeof credential !== 'string' ||
      typeof attemptId !== 'string' ||
      attemptId !== handoff.attemptId
    )
      throw invalidInvitation()
    return { handoff, credential, attemptId }
  }

  private browserAttempt(req: Request): string | undefined {
    const transport = browserSessionContext(req)
    const attempt = req.headers['x-amcore-oauth-attempt']
    if (!transport) {
      if (attempt !== undefined) throw this.invalidExchange()
      return undefined
    }
    if (typeof attempt !== 'string' || !z.string().uuid().safeParse(attempt).success)
      throw this.invalidExchange()
    return attempt
  }

  private invalidExchange(): AppException {
    return new AppException(
      'Invalid OAuth exchange',
      HttpStatus.UNAUTHORIZED,
      AuthErrorCode.OAUTH_TICKET_INVALID
    )
  }
}
