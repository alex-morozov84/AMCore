import { z } from 'zod'

import { SUPPORTED_LOCALES } from '@amcore/shared'

import { fixtureToolContract } from '../../../../test/fixtures/extension-contracts/tool-registration'

import type { AiToolAuthority, AiToolContext } from './ai-tool.types'
import { AiToolContractRegistry } from './ai-tool-contract.registry'
import { prepareToolIntent, readToolIntent } from './ai-tool-intent'
import { currentTimeTool } from './reference/current-time.tool'

import { canonicalJsonHash } from '@/common/utils/canonical-json'
import type { Prisma } from '@/generated/prisma/client'

const ctx: AiToolContext = {
  runId: 'run1',
  conversationId: 'conversation1',
  invocationId: 'invocation1',
  ownerUserId: 'owner1',
  organizationId: null,
  idempotencyKey: 'ai-tool:invocation1',
}
const tx = {} as Prisma.TransactionClient

function authority(): AiToolAuthority {
  return { canDisclose: jest.fn(async () => true), authorize: jest.fn(async () => undefined) }
}

describe('AI immutable intent contract', () => {
  it('stores a detached immutable intent and binds semantic version, schema hashes and owner', async () => {
    const guard = authority()
    const registry = new AiToolContractRegistry([currentTimeTool], [guard])
    const prepared = await prepareToolIntent(currentTimeTool, {}, ctx, tx, 1, registry)
    expect(prepared.intent).toMatchObject({ ownerUserId: 'owner1', toolVersion: 1, originCall: 1 })
    expect(Object.isFrozen(prepared.intent)).toBe(true)
    expect(Object.isFrozen(prepared.intent.args)).toBe(true)
    expect(guard.authorize).toHaveBeenCalledWith(tx, prepared.intent, 'prepare')
    expect(() =>
      readToolIntent({ ...prepared.intent, ownerUserId: 'other' }, prepared.hash)
    ).toThrow('tool_intent_hash_mismatch')
    expect(registry.compatible({ ...prepared.intent, toolVersion: 2 })).toBeNull()
    expect(registry.compatible({ ...prepared.intent, inputSchemaHash: '0'.repeat(64) })).toBeNull()
  })

  it('permits input normalization while requiring stored validation to preserve the result', async () => {
    const parameters = z.object({ count: z.string().transform(Number) }).strict()
    const tool = {
      ...currentTimeTool,
      parameters,
      normalizedSchema: z.object({ count: z.number() }).strict(),
      async prepare(input: { count: number }) {
        return { args: input, target: null, preview: null }
      },
      async execute() {
        return { output: 'done' }
      },
    }
    const registry = new AiToolContractRegistry([tool], [authority()])
    const prepared = await prepareToolIntent(
      tool,
      parameters.parse({ count: '3' }),
      ctx,
      tx,
      1,
      registry
    )
    expect(prepared.intent.args).toEqual({ count: 3 })
    expect(registry.compatible({ ...prepared.intent, args: { count: '3' } })).toBeNull()
  })

  it('refuses an approval-gated action without a meaningful preview before authority admission', async () => {
    const tool = {
      ...currentTimeTool,
      riskClass: 'SENSITIVE' as const,
      idempotency: 'idempotent' as const,
    }
    const guard = authority()
    const registry = new AiToolContractRegistry([tool], [guard])
    await expect(prepareToolIntent(tool, {}, ctx, tx, 1, registry)).rejects.toThrow(
      'tool_approval_description_required'
    )
    expect(guard.authorize).not.toHaveBeenCalled()
  })

  it('derives the complete owner preview from the configured locale topology', async () => {
    const tool = {
      ...currentTimeTool,
      ...fixtureToolContract(currentTimeTool.parameters),
      riskClass: 'SENSITIVE' as const,
      idempotency: 'idempotent' as const,
    }
    const registry = new AiToolContractRegistry([tool], [authority()])
    const prepared = await prepareToolIntent(tool, {}, ctx, tx, 1, registry)
    expect(Object.keys(prepared.intent.preview!).sort()).toEqual([...SUPPORTED_LOCALES].sort())
    for (const locale of SUPPORTED_LOCALES) {
      const guard = authority()
      const incomplete = {
        ...tool,
        async prepare(args: {}) {
          const value = await tool.prepare(args)
          delete value.preview![locale]
          return value
        },
      }
      const local = new AiToolContractRegistry([incomplete], [guard])
      await expect(prepareToolIntent(incomplete, {}, ctx, tx, 1, local)).rejects.toThrow()
      expect(guard.authorize).not.toHaveBeenCalled()
    }
  })

  it('rejects non-JSON arguments even with a self-consistent hash', async () => {
    const registry = new AiToolContractRegistry([currentTimeTool], [authority()])
    const prepared = await prepareToolIntent(currentTimeTool, {}, ctx, tx, 1, registry)
    const invalid = { ...prepared.intent, args: { lost: undefined } }
    expect(() => readToolIntent(invalid, canonicalJsonHash(invalid))).toThrow('invalid_json')
  })
})
