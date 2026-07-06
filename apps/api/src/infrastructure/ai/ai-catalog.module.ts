import { Module } from '@nestjs/common'

import { AiCredentialResolver } from './gateway/credential-resolver'
import { AiModelRegistry } from './registry/ai-model-registry.service'

import { PrismaModule } from '@/prisma'

/**
 * AI catalog module (Track C — ADR-054, Arc C split). The **web-safe** half of the former
 * `AiCoreModule`: the DB-backed model registry and its credential resolver. It is the only AI
 * infrastructure imported by `coreImports()`/web.
 *
 * The DI boundary (the Arc B carried requirement) is enforced here by what is exported, not by
 * convention: **only `AiModelRegistry` is exported** — the secret-free catalog reader the web run
 * producer snapshots from. `AiCredentialResolver` is a private provider (the registry uses it
 * internally for credential-gated default resolution) and is **never exported**, and the
 * `ModelGateway` + provider adapters live in the worker-only `AiGatewayModule`. So a web service
 * can inject the registry but can neither read a credential nor make a provider call.
 */
@Module({
  imports: [PrismaModule],
  providers: [AiCredentialResolver, AiModelRegistry],
  exports: [AiModelRegistry],
})
export class AiCatalogModule {}
