import { ConfigService } from '@nestjs/config'
import type { ClsService } from 'nestjs-cls'
import type { PinoLogger } from 'nestjs-pino'

import { BROWSER_AUTH_HEADERS, type RequestPrincipal } from '@amcore/shared'

import { AdminService } from '../src/core/admin/admin.service.js'
import { AdminCommandAdmission } from '../src/core/admin/admin-command-admission.js'
import { AdminSessionsService } from '../src/core/admin/admin-sessions.service.js'
import { AuditLogService } from '../src/core/audit/audit-log.service.js'
import { hashBrowserBinding } from '../src/core/auth/mfa/browser-binding.js'
import { bindMfaPrincipal } from '../src/core/auth/mfa/mfa-principal-binding.js'
import { mfaCredential } from '../src/core/auth/mfa/mfa-secrets.js'
import { BrowserSessionContextService } from '../src/core/frontend-context/browser-session-context.service.js'
import { EnvService } from '../src/env/env.service.js'
import type { GeoIpService } from '../src/infrastructure/geoip/geoip.service.js'
import type { CleanupService } from '../src/infrastructure/schedule/cleanup.service.js'
import type { StorageService } from '../src/infrastructure/storage/index.js'
import type { PrismaService } from '../src/prisma/index.js'

import { createAuthorityAccount } from './mfa-authority.fixture.js'
import type { MfaProofFixture } from './mfa-proof.fixture.js'

export async function adminCommandFixture(
  fixture: MfaProofFixture,
  windowSec = 600
): Promise<{
  operator: Awaited<ReturnType<typeof createAuthorityAccount>>
  principal: RequestPrincipal
  roleService: AdminService
  sessions: AdminSessionsService
  audit: AuditLogService
  env: EnvService
}> {
  const db = fixture.clients[0]!
  const operator = await createAuthorityAccount(fixture, true, 'operator.command@example.test')
  const key = '<fake-local-command-browser-key-at-least-32>'
  const env = new EnvService(
    new ConfigService({
      WEB_FRONTEND_CONTEXT_KEY: key,
      STEP_UP_MAX_AGE_SECONDS: windowSec,
    })
  )
  const binding = mfaCredential()
  await db.browserAuthContext.update({
    where: { id: operator.requestBinding.contextId },
    data: {
      bindingHash: hashBrowserBinding(binding)!,
    },
  })
  const request = {}
  new BrowserSessionContextService(env).verify(request, {
    [BROWSER_AUTH_HEADERS.key]: key,
    [BROWSER_AUTH_HEADERS.audience]: 'product',
    [BROWSER_AUTH_HEADERS.binding]: binding,
    [BROWSER_AUTH_HEADERS.contextId]: operator.requestBinding.contextId,
    [BROWSER_AUTH_HEADERS.generation]: '1',
  })
  const principal: RequestPrincipal = { type: 'jwt', ...operator.claims }
  bindMfaPrincipal(request, principal)
  const logger = {
    setContext: () => undefined,
    info: () => undefined,
    warn: () => undefined,
  } as unknown as PinoLogger
  const prisma = db as unknown as PrismaService
  const audit = new AuditLogService(
    prisma,
    {
      get: () => undefined,
      getId: () => undefined,
    } as unknown as ClsService,
    logger
  )
  const admission = new AdminCommandAdmission(env)
  return {
    operator,
    env,
    principal,
    audit,
    roleService: new AdminService(
      prisma,
      {} as CleanupService,
      audit,
      logger,
      {} as StorageService,
      admission
    ),
    sessions: new AdminSessionsService(prisma, {} as GeoIpService, audit, logger, admission),
  }
}
