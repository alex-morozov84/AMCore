import { AiToolRiskClass } from '@prisma/client'

import type { AiToolContext } from '../ai-tool.types'

import { currentTimeTool } from './current-time.tool'

function ctx(): AiToolContext {
  return {
    runId: 'run_1',
    conversationId: 'conv_1',
    ownerUserId: 'user_1',
    organizationId: null,
    invocationId: 'inv_1',
    idempotencyKey: 'ai-tool:inv_1',
  }
}

describe('currentTimeTool', () => {
  it('is a SAFE, read-only tool with a stable id', () => {
    expect(currentTimeTool.toolId).toBe('current_time')
    expect(currentTimeTool.riskClass).toBe(AiToolRiskClass.SAFE)
    expect(currentTimeTool.idempotency).toBe('read_only')
  })

  it('takes no arguments (rejects extra keys)', () => {
    expect(currentTimeTool.parameters.safeParse({}).success).toBe(true)
    expect(currentTimeTool.parameters.safeParse({ tz: 'UTC' }).success).toBe(false)
  })

  it('returns the current time as a bounded ISO-8601 UTC string', async () => {
    const result = await currentTimeTool.execute({}, ctx())
    expect(result.output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(new Date(result.output).toISOString()).toBe(result.output)
  })

  it('has no side effects (repeated calls both yield parseable times)', async () => {
    const first = await currentTimeTool.execute({}, ctx())
    const second = await currentTimeTool.execute({}, ctx())
    expect(Number.isNaN(Date.parse(first.output))).toBe(false)
    expect(Number.isNaN(Date.parse(second.output))).toBe(false)
  })
})
