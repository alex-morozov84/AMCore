import { z } from 'zod'

import { AI_TOOL_REGISTRY_MAX_SIZE } from './ai-tool.constants'
import type { AiTool } from './ai-tool.types'
import { AiToolRegistry } from './ai-tool-registry.service'

import { AiToolRiskClass } from '@/generated/prisma/client'

function makeTool(overrides: Partial<AiTool> = {}): AiTool {
  return {
    toolId: 'sample_tool',
    displayName: 'Sample',
    description: 'A sample tool.',
    parameters: z.object({}).strict(),
    riskClass: AiToolRiskClass.SAFE,
    idempotency: 'read_only',
    execute: () => Promise.resolve({ output: 'ok' }),
    ...overrides,
  }
}

describe('AiToolRegistry', () => {
  describe('validation at construction (fail closed)', () => {
    it('registers a valid tool set', () => {
      const registry = new AiToolRegistry([makeTool({ toolId: 'a' }), makeTool({ toolId: 'b' })])
      expect(registry.ids().sort()).toEqual(['a', 'b'])
    })

    it('rejects a duplicate tool id', () => {
      expect(
        () => new AiToolRegistry([makeTool({ toolId: 'dup' }), makeTool({ toolId: 'dup' })])
      ).toThrow(/duplicate/)
    })

    it.each(['Bad', 'with-hyphen', '1leading', 'has space', ''])(
      'rejects invalid tool id %p',
      (toolId) => {
        expect(() => new AiToolRegistry([makeTool({ toolId })])).toThrow(/invalid tool id/)
      }
    )

    it('rejects a tool id over the length cap', () => {
      expect(() => new AiToolRegistry([makeTool({ toolId: 'a'.repeat(49) })])).toThrow(
        /invalid tool id/
      )
    })

    it('rejects a non-retry-safe (unsafe) tool', () => {
      expect(
        () =>
          new AiToolRegistry([
            makeTool({ riskClass: AiToolRiskClass.DESTRUCTIVE, idempotency: 'unsafe' }),
          ])
      ).toThrow(/unsafe/)
    })

    it('accepts an idempotent sensitive/destructive tool', () => {
      const registry = new AiToolRegistry([
        makeTool({
          toolId: 'sens',
          riskClass: AiToolRiskClass.SENSITIVE,
          idempotency: 'idempotent',
        }),
      ])
      expect(registry.ids()).toEqual(['sens'])
    })

    it('rejects more tools than the registry cap', () => {
      const tools = Array.from({ length: AI_TOOL_REGISTRY_MAX_SIZE + 1 }, (_, i) =>
        makeTool({ toolId: `t${i}` })
      )
      expect(() => new AiToolRegistry(tools)).toThrow(/too many tools/)
    })
  })

  describe('allowlist filtering (least privilege)', () => {
    const registry = new AiToolRegistry([
      makeTool({ toolId: 'alpha' }),
      makeTool({ toolId: 'beta' }),
    ])

    it('returns no tools for an empty allowlist', () => {
      expect(registry.resolveAllowed([])).toEqual([])
      expect(registry.describeAllowed([])).toEqual([])
    })

    it('returns only allowlisted tools', () => {
      expect(registry.resolveAllowed(['alpha']).map((t) => t.toolId)).toEqual(['alpha'])
    })

    it('ignores an allowlist entry with no matching registered tool (never invented)', () => {
      expect(registry.resolveAllowed(['alpha', 'ghost']).map((t) => t.toolId)).toEqual(['alpha'])
    })

    it('projects content-free descriptors (no execute)', () => {
      const descriptors = registry.describeAllowed(['beta'])
      expect(descriptors).toHaveLength(1)
      const descriptor = descriptors[0]
      expect(descriptor).toMatchObject({ toolId: 'beta', riskClass: AiToolRiskClass.SAFE })
      expect('execute' in (descriptor as object)).toBe(false)
    })
  })

  describe('risk → approval policy', () => {
    const registry = new AiToolRegistry([makeTool()])

    it('does not require approval for a SAFE tool', () => {
      expect(registry.requiresApproval(makeTool({ riskClass: AiToolRiskClass.SAFE }))).toBe(false)
    })

    it('requires approval for SENSITIVE and DESTRUCTIVE tools', () => {
      expect(
        registry.requiresApproval(
          makeTool({ riskClass: AiToolRiskClass.SENSITIVE, idempotency: 'idempotent' })
        )
      ).toBe(true)
      expect(
        registry.requiresApproval(
          makeTool({ riskClass: AiToolRiskClass.DESTRUCTIVE, idempotency: 'idempotent' })
        )
      ).toBe(true)
    })
  })

  describe('get', () => {
    const registry = new AiToolRegistry([makeTool({ toolId: 'known' })])

    it('returns a registered tool and undefined for an unknown id', () => {
      expect(registry.get('known')?.toolId).toBe('known')
      expect(registry.get('unknown')).toBeUndefined()
    })
  })
})
