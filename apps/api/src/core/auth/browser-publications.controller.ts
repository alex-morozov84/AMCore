import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common'
import {
  ApiBadRequestResponse,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger'
import type { Request } from 'express'
import { z } from 'zod'

import {
  AuthType,
  BROWSER_AUTH_HEADERS,
  browserBindingProbeInputSchema,
  type BrowserBindingProbeResult,
  browserBindingProbeResultSchema,
  browserBootstrapInputSchema,
  type BrowserBootstrapResult,
  browserBootstrapResultSchema,
  type BrowserContextView,
  browserContextViewSchema,
} from '@amcore/shared'

import { createSchemaDto } from '../../common/schemas/schema-dto.js'
import { SchemaResponse } from '../../common/schemas/schema-response.js'
import { resolveVerifiedVisitorIp } from '../../common/utils/verified-visitor-ip.js'
import { EnvService } from '../../env/env.service.js'
import { browserSessionContext } from '../frontend-context/browser-session-context.service.js'

import { Auth } from './decorators/auth.decorator.js'
import { BrowserPublicationGuard } from './mfa/browser-publication.guard.js'
import {
  browserContextChanged,
  BrowserPublicationService,
} from './mfa/browser-publication.service.js'
import {
  OrganizationContextBoundary,
  RequestContextPolicy,
} from './organization-context/request-context-policy.js'

class BootstrapInput extends createSchemaDto(browserBootstrapInputSchema) {}
const BootstrapResult = createSchemaDto(browserBootstrapResultSchema, 'BrowserBootstrapResult')
class BindingInput extends createSchemaDto(
  z.object({ binding: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict()
) {}
class ContextView extends createSchemaDto(browserContextViewSchema) {}
class ProbeInput extends createSchemaDto(browserBindingProbeInputSchema) {}
class ProbeResult extends createSchemaDto(browserBindingProbeResultSchema) {}

@ApiTags('auth')
@ApiConsumes('application/json')
@ApiHeader({
  name: BROWSER_AUTH_HEADERS.key,
  required: true,
  description: 'Private BFF transport key; never expose it to a browser',
})
@ApiHeader({
  name: BROWSER_AUTH_HEADERS.audience,
  required: true,
  enum: ['product', 'staff', 'console'],
})
@ApiBadRequestResponse({ description: 'Invalid strict body or unexpected query' })
@ApiForbiddenResponse({
  description: 'Missing/invalid private transport or mixed credential authority',
})
@ApiUnauthorizedResponse({
  description:
    'AUTH_CONTEXT_CHANGED: terminal browser binding mismatch; never refresh or adopt another family',
})
@ApiTooManyRequestsResponse({ description: 'Global request/source bootstrap budget exceeded' })
@ApiServiceUnavailableResponse({
  description: 'Primary verification or source limiter unavailable; no cached identity fallback',
})
@Controller('auth/browser-publications')
@Auth(AuthType.None)
@OrganizationContextBoundary({ apiRoots: [] })
@UseGuards(BrowserPublicationGuard)
export class BrowserPublicationsController {
  constructor(
    private readonly browsers: BrowserPublicationService,
    private readonly env: EnvService
  ) {}

  @Post('bootstrap')
  @HttpCode(200)
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Create or read an account-neutral browser anchor, separately from sign-in',
    description:
      'Only a newly created anchor returns its binding. A known expired binding renews the same context atomically after retiring its old generation. Existing status never re-emits an old capability or issues credentials.',
  })
  @SchemaResponse({ type: BootstrapResult, status: 200 })
  bootstrap(
    @Body({ schema: BootstrapInput.schema }) body: BootstrapInput,
    @Req() req: Request
  ): Promise<BrowserBootstrapResult> {
    return this.browsers.bootstrap(
      browserSessionContext(req)!.audience,
      body.binding,
      resolveVerifiedVisitorIp(req, this.env) ?? req.ip ?? req.socket?.remoteAddress ?? ''
    )
  }

  @Post('status')
  @HttpCode(200)
  @RequestContextPolicy({ kind: 'personal' })
  @ApiOperation({
    summary: 'Read only a browser revision without returning an account or binding secret',
  })
  @SchemaResponse({ type: ContextView, status: 200 })
  status(
    @Body({ schema: BindingInput.schema }) body: BindingInput,
    @Req() req: Request
  ): Promise<BrowserContextView> {
    return this.browsers.status(browserSessionContext(req)!.audience, body.binding)
  }

  @Post('probe')
  @HttpCode(200)
  @RequestContextPolicy({ kind: 'personal' })
  @ApiHeader({
    name: BROWSER_AUTH_HEADERS.binding,
    required: true,
    description: 'Actual HttpOnly browser capability, supplied by BFF',
  })
  @ApiHeader({ name: BROWSER_AUTH_HEADERS.contextId, required: true })
  @ApiHeader({ name: BROWSER_AUTH_HEADERS.generation, required: true })
  @ApiOperation({
    summary: 'Verify exact published browser/family authority using a vaulted refresh proof',
    description:
      'Works before access refresh without trusting an expired access JWT. A retained rotated row can prove identity only; this route never rotates, revokes, publishes or issues credentials.',
  })
  @SchemaResponse({ type: ProbeResult, status: 200 })
  probe(
    @Body({ schema: ProbeInput.schema }) body: ProbeInput,
    @Req() req: Request
  ): Promise<BrowserBindingProbeResult> {
    const binding = browserSessionContext(req)?.binding
    if (!binding) throw browserContextChanged()
    return this.browsers.probe(body, binding)
  }
}
