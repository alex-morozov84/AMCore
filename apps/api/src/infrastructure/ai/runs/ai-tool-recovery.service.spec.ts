import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import type { AiTool } from '../tools/ai-tool.types'
import type { AiToolRegistry } from '../tools/ai-tool-registry.service'

import type { ClaimedRun } from './ai-run-dispatch.types'
import type { AiRunTransitions } from './ai-run-transitions.service'
import type { AiToolActionService, ToolRunContext } from './ai-tool-action.service'
import type { InvocationRow } from './ai-tool-invocation.store'
import { AiToolRecoveryService } from './ai-tool-recovery.service'

import { AiToolInvocationStatus, AiToolRiskClass } from '@/generated/prisma/client'
import type { AttemptRuntime } from '@/infrastructure/worker-lifecycle'
import type { PrismaService } from '@/prisma'

/**
 * The recovery table (E12): at the start of every epoch the run's unfinished tool action is resolved
 * BEFORE the model is asked again, so a requested action can never be replaced by a fresh one with a fresh
 * idempotency key. One test per durable state.
 */
const CLAIM = { id: 'run-1', epoch: 5 } as ClaimedRun
const CTX = {
  claim: CLAIM,
  runtime: {} as AttemptRuntime,
  ownerUserId: 'u1',
  organizationId: null,
} as ToolRunContext

const TOOL: AiTool = {
  toolId: 'archive_document',
  displayName: 'Archive',
  description: 'archive',
  parameters: z.object({}).strict(),
  riskClass: AiToolRiskClass.SAFE,
  idempotency: 'idempotent',
  execute: jest.fn(),
}

function action(over: Partial<InvocationRow> = {}): InvocationRow {
  return {
    id: 'inv-1',
    toolId: 'archive_document',
    riskClass: 'SAFE',
    idempotency: 'idempotent',
    status: AiToolInvocationStatus.REQUESTED,
    executionEpoch: null,
    argsSnapshot: {},
    originCall: 1,
    errorCode: null,
    appliedAt: null,
    ...over,
  } as InvocationRow
}

describe('AiToolRecoveryService', () => {
  let prisma: DeepMockProxy<PrismaService>
  let registry: { get: jest.Mock }
  let actions: { execute: jest.Mock; applyRejected: jest.Mock }
  let transitions: { failed: jest.Mock }
  let recovery: AiToolRecoveryService

  function pending(row: InvocationRow | null): void {
    prisma.aiToolInvocation.findFirst.mockResolvedValue(row as never)
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaService>()
    registry = { get: jest.fn(() => TOOL) }
    actions = {
      execute: jest.fn().mockResolvedValue({ status: 'succeeded' }),
      applyRejected: jest.fn().mockResolvedValue({ status: 'succeeded' }),
    }
    transitions = { failed: jest.fn().mockResolvedValue('applied') }
    recovery = new AiToolRecoveryService(
      prisma,
      registry as unknown as AiToolRegistry,
      actions as unknown as AiToolActionService,
      transitions as unknown as AiRunTransitions
    )
  })

  it('proceeds (asks the model) only when nothing is pending', async () => {
    pending(null)

    expect(await recovery.recover(CTX)).toBe('proceed')
    expect(actions.execute).not.toHaveBeenCalled()
  })

  it.each([
    [AiToolInvocationStatus.REQUESTED, 'start it: it never ran'],
    [AiToolInvocationStatus.APPROVED, 'start the approved action'],
    [
      AiToolInvocationStatus.EXECUTING,
      'adopt (read-only) or fail uncertain — decided by the one-shot start',
    ],
  ])(
    '%s → drives the action through the one-shot start (%s), recovering with the SYNTHETIC call id, no stored args',
    async (status, _note) => {
      pending(action({ status }))

      expect(await recovery.recover(CTX)).toBe('proceed')

      expect(actions.execute).toHaveBeenCalledWith(
        CTX,
        expect.objectContaining({ id: 'inv-1' }),
        TOOL,
        'ai-tool-inv:inv-1'
      ) // exactly 4 args: the stored snapshot is re-validated by `execute`, never trusted blindly
    }
  )

  it.each(['terminal', 'exit'])('stops when the resumed action ends %s', async (status) => {
    pending(action())
    actions.execute.mockResolvedValue({ status })

    expect(await recovery.recover(CTX)).toBe('done')
  })

  it('OUTCOME_UNKNOWN → the run fails uncertain with NO model request and NO new action', async () => {
    pending(action({ status: AiToolInvocationStatus.OUTCOME_UNKNOWN }))

    expect(await recovery.recover(CTX)).toBe('done')
    expect(transitions.failed).toHaveBeenCalledWith(
      CLAIM,
      'tool_loop_failed',
      'tool_effect_unknown'
    )
    expect(actions.execute).not.toHaveBeenCalled()
  })

  it.each([
    ['tool_schema_incompatible', 'tool_schema_incompatible'],
    ['tool_rejected_no_effect', 'tool_execution_failed'],
    [null, 'tool_execution_failed'],
  ])(
    'FAILED (%s) on a still-running run → the persisted policy applies, the model is NOT re-asked',
    async (errorCode, reason) => {
      pending(action({ status: AiToolInvocationStatus.FAILED, errorCode }))

      expect(await recovery.recover(CTX)).toBe('done')
      expect(transitions.failed).toHaveBeenCalledWith(CLAIM, 'tool_loop_failed', reason)
    }
  )

  it('REJECTED, unapplied → applies the rejection once, then proceeds', async () => {
    pending(action({ status: AiToolInvocationStatus.REJECTED }))

    expect(await recovery.recover(CTX)).toBe('proceed')
    expect(actions.applyRejected).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ id: 'inv-1' })
    )
  })

  it('REJECTED whose application did not complete → done (the run stops, nothing is applied twice)', async () => {
    pending(action({ status: AiToolInvocationStatus.REJECTED }))
    actions.applyRejected.mockResolvedValue({ status: 'exit' })

    expect(await recovery.recover(CTX)).toBe('done')
  })

  it('SUCCEEDED but unapplied → inconsistent: fails closed, never fabricates a successful application', async () => {
    pending(action({ status: AiToolInvocationStatus.SUCCEEDED }))

    expect(await recovery.recover(CTX)).toBe('done')
    expect(transitions.failed).toHaveBeenCalledWith(
      CLAIM,
      'tool_loop_failed',
      'tool_state_inconsistent'
    )
  })

  it('a tool no longer registered is refused (tool_not_allowed), never executed', async () => {
    pending(action())
    registry.get.mockReturnValue(undefined)

    expect(await recovery.recover(CTX)).toBe('done')
    expect(transitions.failed).toHaveBeenCalledWith(CLAIM, 'tool_loop_failed', 'tool_not_allowed')
    expect(actions.execute).not.toHaveBeenCalled()
  })

  it('an approval authorizes only the exact risk the owner saw: a changed risk class is not run', async () => {
    pending(action({ status: AiToolInvocationStatus.APPROVED, riskClass: 'SENSITIVE' }))

    expect(await recovery.recover(CTX)).toBe('done')
    expect(transitions.failed).toHaveBeenCalledWith(CLAIM, 'tool_loop_failed', 'tool_not_allowed')
    expect(actions.execute).not.toHaveBeenCalled()
  })

  it('selects only unfinished actions (applied/skipped/awaiting-approval rows are never picked up)', async () => {
    pending(null)

    await recovery.recover(CTX)

    const where = prisma.aiToolInvocation.findFirst.mock.calls[0]![0]!.where as {
      OR: { status: { in: string[] }; appliedAt?: null }[]
    }
    const statuses = where.OR.flatMap((clause) => clause.status.in)
    expect(statuses).toEqual(
      expect.arrayContaining([
        'REQUESTED',
        'APPROVED',
        'EXECUTING',
        'OUTCOME_UNKNOWN',
        'FAILED',
        'SUCCEEDED',
        'REJECTED',
      ])
    )
    expect(statuses).not.toContain('AWAITING_APPROVAL')
    expect(statuses).not.toContain('SKIPPED')
    expect(where.OR[1]).toMatchObject({ appliedAt: null }) // SUCCEEDED/REJECTED count only while unapplied
  })
})
