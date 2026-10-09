import { type DynamicModule, Injectable, Module, type Type } from '@nestjs/common'
import { z } from 'zod'

import { Action, Subject, SUPPORTED_LOCALES } from '@amcore/shared'

import { ForbiddenException } from '../../../src/common/exceptions'
import { DomainAuthorizationModule } from '../../../src/core/auth/domain-authorization.module'
import { DomainAuthorizationService } from '../../../src/core/auth/domain-authorization.service'
import { lockOrganization } from '../../../src/core/organizations/organization-mutation-lock'
import type { Prisma } from '../../../src/generated/prisma/client'
import type {
  AiTool,
  AiToolAuthority,
  AiToolContext,
  AiToolIntent,
  AiToolPreparation,
  AiToolRegistration,
  AiToolResult,
} from '../../../src/infrastructure/ai/tools/ai-tool.types'
import { AiToolRejectedError } from '../../../src/infrastructure/ai/tools/ai-tool-error'
import { PrismaModule, PrismaService } from '../../../src/prisma'

const argsSchema = z
  .object({ organizationId: z.string().min(1), name: z.string().min(1).max(100) })
  .strict()

@Injectable()
export class FixtureOrganizationAuthority implements AiToolAuthority {
  constructor(private readonly authorization: DomainAuthorizationService) {}
  private async target(
    tx: Prisma.TransactionClient,
    intent: AiToolIntent
  ): Promise<Awaited<ReturnType<Prisma.TransactionClient['organization']['findUniqueOrThrow']>>> {
    if (intent.target?.kind !== 'Organization' || intent.target.id !== intent.organizationId) {
      throw new AiToolRejectedError()
    }
    const row = await tx.organization.findUniqueOrThrow({ where: { id: intent.target.id } })
    return row
  }
  async canDisclose(tx: Prisma.TransactionClient, intent: AiToolIntent): Promise<boolean> {
    try {
      const row = await this.target(tx, intent)
      await this.authorization.assert(
        tx,
        intent.ownerUserId,
        intent.organizationId,
        Action.Read,
        Subject.Organization,
        row,
        ['name']
      )
      return true
    } catch {
      return false
    }
  }
  async authorize(
    tx: Prisma.TransactionClient,
    intent: AiToolIntent,
    _phase: 'prepare' | 'approve' | 'execute' = 'execute'
  ): Promise<void> {
    const row = await this.target(tx, intent)
    await this.authorization.assert(
      tx,
      intent.ownerUserId,
      intent.organizationId,
      Action.Update,
      Subject.Organization,
      row,
      ['name']
    )
  }
}
@Module({
  imports: [DomainAuthorizationModule],
  providers: [FixtureOrganizationAuthority],
  exports: [FixtureOrganizationAuthority],
})
class FixtureOrganizationAuthorityModule {}

export const fixtureOrganizationContract = {
  toolId: 'fixture_rename_organization',
  contractVersion: 1,
  displayName: 'Fixture organization rename',
  description: 'Rename the fixture organization.',
  parameters: z.object({}).strict(),
  normalizedSchema: argsSchema,
  riskClass: 'SENSITIVE' as const,
  idempotency: 'idempotent' as const,
  authority: { module: FixtureOrganizationAuthorityModule, token: FixtureOrganizationAuthority },
}

@Injectable()
export class FixtureOrganizationTool implements AiTool<
  Record<string, never>,
  z.infer<typeof argsSchema>
> {
  readonly toolId = fixtureOrganizationContract.toolId
  readonly contractVersion = fixtureOrganizationContract.contractVersion
  readonly displayName = fixtureOrganizationContract.displayName
  readonly description = fixtureOrganizationContract.description
  readonly parameters = fixtureOrganizationContract.parameters
  readonly normalizedSchema = fixtureOrganizationContract.normalizedSchema
  readonly riskClass = fixtureOrganizationContract.riskClass
  readonly idempotency = fixtureOrganizationContract.idempotency
  readonly authority = fixtureOrganizationContract.authority
  constructor(
    private readonly prisma: PrismaService,
    private readonly rights: FixtureOrganizationAuthority
  ) {}
  async prepare(
    _input: Record<string, never>,
    context: AiToolContext,
    tx: Prisma.TransactionClient
  ): Promise<AiToolPreparation<z.infer<typeof argsSchema>>> {
    if (!context.organizationId) throw new AiToolRejectedError()
    const row = await tx.organization.findUniqueOrThrow({ where: { id: context.organizationId } })
    const name = `${row.name.slice(0, 80)} fixture`
    return {
      args: { organizationId: row.id, name },
      target: { kind: 'Organization', id: row.id, revision: row.aclVersion },
      preview: Object.fromEntries(
        SUPPORTED_LOCALES.map((locale) => [
          locale,
          {
            title: 'Rename organization',
            summary: `Set organization name to ${name}`,
            target: { id: row.id, label: row.name },
            effects: [`Name becomes ${name}`],
          },
        ])
      ),
    }
  }
  async execute(
    intent: AiToolIntent<z.infer<typeof argsSchema>>,
    context: AiToolContext
  ): Promise<AiToolResult> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM core.users WHERE id = ${context.ownerUserId} FOR SHARE`
      const locked = await lockOrganization(tx, intent.args.organizationId)
      try {
        await this.rights.authorize(tx, intent)
      } catch (error) {
        // Rights refusal precedes every mutation; transaction rollback proves no effect.
        if (error instanceof ForbiddenException) throw new AiToolRejectedError()
        throw error
      }
      // A completed same-key effect is returned before its own revision bump can reject replay.
      const receipts = await tx.$queryRaw<{ key: string }[]>`
        SELECT key FROM core.extension_fixture_tool_effects WHERE key = ${context.idempotencyKey}`
      if (receipts.length) return
      if (context.signal?.aborted || locked.aclVersion !== intent.target?.revision)
        throw new AiToolRejectedError()
      await tx.organization.update({
        where: { id: locked.id },
        data: { name: intent.args.name, aclVersion: { increment: 1 } },
      })
      await tx.$executeRaw`INSERT INTO core.extension_fixture_tool_effects (key, "organizationId")
        VALUES (${context.idempotencyKey}, ${locked.id})`
    })
    return { output: 'organization renamed' }
  }
}
@Module({})
class FixtureOrganizationWorkerModule {
  static register(core: Type<unknown>): DynamicModule {
    return {
      module: FixtureOrganizationWorkerModule,
      imports: [core, PrismaModule, FixtureOrganizationAuthorityModule],
      providers: [FixtureOrganizationTool],
      exports: [FixtureOrganizationTool],
    }
  }
}
export const fixtureOrganizationRegistration: AiToolRegistration = {
  contract: fixtureOrganizationContract,
  executorToken: FixtureOrganizationTool,
  worker: (core) => FixtureOrganizationWorkerModule.register(core),
}
