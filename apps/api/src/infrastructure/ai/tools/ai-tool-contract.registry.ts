import { Injectable } from '@nestjs/common'
import { z } from 'zod'

import {
  AI_TOOL_ID_MAX_LENGTH,
  AI_TOOL_ID_PATTERN,
  AI_TOOL_REGISTRY_MAX_SIZE,
} from './ai-tool.constants'
import type { AiToolAuthority, AiToolContract, AiToolIntent } from './ai-tool.types'

import { canonicalJsonEqual, canonicalJsonHash } from '@/common/utils/canonical-json'

export interface RegisteredToolContract {
  contract: AiToolContract
  authority: AiToolAuthority
  inputSchemaHash: string
  normalizedSchemaHash: string
}

/** Inert schema/metadata and headless authority; no prepare or execute provider in web DI. */
@Injectable()
export class AiToolContractRegistry {
  private readonly entries = new Map<string, RegisteredToolContract>()

  constructor(contracts: readonly AiToolContract[], authorities: readonly AiToolAuthority[]) {
    if (contracts.length > AI_TOOL_REGISTRY_MAX_SIZE || contracts.length !== authorities.length) {
      throw new Error('Invalid tool contract inventory')
    }
    for (const [index, contract] of contracts.entries()) {
      const authority = authorities[index]
      if (
        !AI_TOOL_ID_PATTERN.test(contract.toolId) ||
        contract.toolId.length > AI_TOOL_ID_MAX_LENGTH ||
        this.entries.has(contract.toolId) ||
        !Number.isSafeInteger(contract.contractVersion) ||
        contract.contractVersion < 1 ||
        !['read_only', 'idempotent'].includes(contract.idempotency) ||
        !['SAFE', 'SENSITIVE', 'DESTRUCTIVE'].includes(contract.riskClass) ||
        !authority?.authorize ||
        !authority.canDisclose
      )
        throw new Error('Invalid tool contract')
      // Output conversion rejects transforms; stored validation must preserve representation.
      z.toJSONSchema(contract.normalizedSchema, { io: 'output' })
      this.entries.set(contract.toolId, {
        contract,
        authority,
        inputSchemaHash: canonicalJsonHash(z.toJSONSchema(contract.parameters, { io: 'input' })),
        normalizedSchemaHash: canonicalJsonHash(
          z.toJSONSchema(contract.normalizedSchema, { io: 'input' })
        ),
      })
    }
  }

  get(id: string): RegisteredToolContract | undefined {
    return this.entries.get(id)
  }

  compatible(intent: AiToolIntent): RegisteredToolContract | null {
    const entry = this.get(intent.toolId)
    if (
      !entry ||
      entry.contract.contractVersion !== intent.toolVersion ||
      entry.inputSchemaHash !== intent.inputSchemaHash ||
      entry.normalizedSchemaHash !== intent.normalizedSchemaHash ||
      entry.contract.riskClass !== intent.riskClass ||
      entry.contract.idempotency !== intent.idempotency
    )
      return null
    const parsed = entry.contract.normalizedSchema.safeParse(intent.args)
    return parsed.success && canonicalJsonEqual(parsed.data, intent.args) ? entry : null
  }
}
