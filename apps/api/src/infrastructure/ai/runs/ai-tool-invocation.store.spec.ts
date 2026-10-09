import { type DeepMockProxy, mockDeep } from 'jest-mock-extended'
import { z } from 'zod'

import { demoSensitiveTool } from '../../../../test/fixtures/demo-sensitive.tool'
import {
  FixtureToolAuthority,
  fixtureToolContract,
} from '../../../../test/fixtures/extension-contracts/tool-registration'
import { AiToolContractRegistry } from '../tools/ai-tool-contract.registry'
import { prepareToolIntent } from '../tools/ai-tool-intent'

import type { AiRunRepository } from './ai-run.repository'
import type { ClaimedRun } from './ai-run-dispatch.types'
import { RunLeaseLostError } from './ai-run-guard.service'
import {
  applyRejection,
  type InvocationRow,
  recordFailure,
  recordSuccess,
  sameAction,
  startExecution,
} from './ai-tool-invocation.store'

import { AiToolInvocationStatus } from '@/generated/prisma/client'
import type { PrismaService } from '@/prisma'

/**
 * The durable tool-action steps (E12): one-shot start, epoch-owned result/failure, once-only application.
 * Every function runs inside the run guard's transaction, so the stale-holder case is proved in the guard
 * and e2e suites; here the compare-and-set predicates and outcomes are pinned over a scripted client.
 */
const CLAIM: ClaimedRun = {
  id: 'run-1',
  conversationId: 'conv-1',
  modelSnapshot: {},
  epoch: 4,
  attemptNumber: 1,
  maxAttempts: 3,
  deadlineAt: null,
  ownershipGeneration: 0,
  leaseToken: 'lease',
}

function action(over: Partial<InvocationRow> = {}): InvocationRow {
  return {
    id: 'inv-1',
    toolId: 'archive_document',
    riskClass: 'SENSITIVE',
    idempotency: 'idempotent',
    status: AiToolInvocationStatus.REQUESTED,
    executionEpoch: null,
    argsSnapshot: { documentId: 'd1' },
    originCall: 1,
    errorCode: null,
    appliedAt: null,
    ...over,
  } as InvocationRow
}

describe('tool invocation store', () => {
  let tx: DeepMockProxy<PrismaService>
  let repository: DeepMockProxy<AiRunRepository>

  beforeEach(() => {
    tx = mockDeep<PrismaService>()
    repository = mockDeep<AiRunRepository>()
    repository.finalizeFailed.mockResolvedValue(true)
  })

  describe('startExecution (one-shot start CAS)', () => {
    it('starts a REQUESTED/APPROVED invocation under THIS epoch', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)

      expect(await startExecution(tx, repository, CLAIM, action())).toBe('started')
      expect(tx.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1', status: { in: ['REQUESTED', 'APPROVED'] } },
          data: expect.objectContaining({ status: 'EXECUTING', executionEpoch: 4 }),
        })
      )
    })

    it('a repeat inside the SAME epoch is in_progress — never a second physical call', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
      tx.aiToolInvocation.findUnique.mockResolvedValue({
        status: 'EXECUTING',
        executionEpoch: 4,
        idempotency: 'read_only',
      } as never)

      expect(await startExecution(tx, repository, CLAIM, action())).toBe('in_progress')
      expect(repository.finalizeFailed).not.toHaveBeenCalled()
    })

    it('adopts an older-epoch EXECUTING invocation ONLY for a read_only tool (safe repeat)', async () => {
      tx.aiToolInvocation.updateMany
        .mockResolvedValueOnce({ count: 0 } as never) // start CAS misses (already EXECUTING)
        .mockResolvedValueOnce({ count: 1 } as never) // adoption wins
      tx.aiToolInvocation.findUnique.mockResolvedValue({
        status: 'EXECUTING',
        executionEpoch: 2,
        idempotency: 'read_only',
      } as never)

      expect(await startExecution(tx, repository, CLAIM, action())).toBe('adopted')
      expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1', status: 'EXECUTING', executionEpoch: { not: 4 } },
          data: expect.objectContaining({ executionEpoch: 4 }),
        })
      )
    })

    it.each([
      ['idempotent', 'idempotent'],
      ['a legacy NULL class', null],
    ])(
      'an older-epoch EXECUTING %s tool becomes OUTCOME_UNKNOWN and fails the run uncertain — never re-executed',
      async (_label, idempotency) => {
        tx.aiToolInvocation.updateMany
          .mockResolvedValueOnce({ count: 0 } as never)
          .mockResolvedValueOnce({ count: 1 } as never)
        tx.aiToolInvocation.findUnique.mockResolvedValue({
          status: 'EXECUTING',
          executionEpoch: 2,
          idempotency,
        } as never)

        expect(await startExecution(tx, repository, CLAIM, action())).toBe('unknown')
        expect(tx.aiToolInvocation.updateMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              status: 'OUTCOME_UNKNOWN',
              errorCode: 'tool_effect_unknown',
            }),
          })
        )
        expect(repository.finalizeFailed).toHaveBeenCalledWith(
          tx,
          CLAIM,
          'tool_loop_failed',
          'tool_effect_unknown'
        )
      }
    )

    it('an already OUTCOME_UNKNOWN invocation fails the run uncertain without a new execution', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
      tx.aiToolInvocation.findUnique.mockResolvedValue({
        status: 'OUTCOME_UNKNOWN',
        executionEpoch: 2,
        idempotency: 'idempotent',
      } as never)

      expect(await startExecution(tx, repository, CLAIM, action())).toBe('unknown')
      expect(repository.finalizeFailed).toHaveBeenCalled()
    })

    it.each(['SUCCEEDED', 'FAILED', 'SKIPPED', 'REJECTED'])(
      'is gone once the invocation is %s',
      async (status) => {
        tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
        tx.aiToolInvocation.findUnique.mockResolvedValue({
          status,
          executionEpoch: 4,
          idempotency: 'read_only',
        } as never)

        expect(await startExecution(tx, repository, CLAIM, action())).toBe('gone')
      }
    )

    it('rolls back (lease lost) when failing the run uncertain loses the run CAS', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)
      tx.aiToolInvocation.findUnique.mockResolvedValue({
        status: 'OUTCOME_UNKNOWN',
        executionEpoch: 2,
        idempotency: 'idempotent',
      } as never)
      repository.finalizeFailed.mockResolvedValue(false)

      await expect(startExecution(tx, repository, CLAIM, action())).rejects.toBeInstanceOf(
        RunLeaseLostError
      )
    })
  })

  describe('recordSuccess (result owned by the starting epoch)', () => {
    const result = { output: 'done', durationMs: 5, toolCallId: 'call-1' }

    it('CASes EXECUTING+epoch → SUCCEEDED and applies it to the transcript exactly once (appliedAt + ordering step)', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
      tx.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 1 } } as never)

      await recordSuccess(tx, CLAIM, action({ status: 'EXECUTING' as never }), result, true)

      const [{ where, data }] = tx.aiToolInvocation.updateMany.mock.calls[0] as unknown as [
        { where: object; data: Record<string, unknown> },
      ]
      expect(where).toEqual({
        id: 'inv-1',
        status: 'EXECUTING',
        executionEpoch: 4,
        appliedAt: null,
      })
      expect(data).toMatchObject({ status: 'SUCCEEDED', resultSummary: { output: 'done' } })
      expect(data.appliedAt).toBeInstanceOf(Date)
      expect(tx.aiRunStep.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'TOOL_INVOCATION',
            stepNumber: 2,
            detail: { invocationId: 'inv-1', toolCallId: 'call-1' },
          }),
        })
      )
    })

    it('with a visible stop the known outcome is recorded but NOT applied (no appliedAt, no step)', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)

      await recordSuccess(tx, CLAIM, action(), result, false)

      const [{ data }] = tx.aiToolInvocation.updateMany.mock.calls[0] as unknown as [
        { data: Record<string, unknown> },
      ]
      expect(data.status).toBe('SUCCEEDED')
      expect(data).not.toHaveProperty('appliedAt')
      expect(tx.aiRunStep.create).not.toHaveBeenCalled()
    })

    it('a stale/duplicate result (CAS misses) rolls back — it can never overwrite the authoritative outcome', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)

      await expect(recordSuccess(tx, CLAIM, action(), result, true)).rejects.toBeInstanceOf(
        RunLeaseLostError
      )
      expect(tx.aiRunStep.create).not.toHaveBeenCalled()
    })
  })

  describe('recordFailure', () => {
    it('records FAILED / OUTCOME_UNKNOWN under the starting epoch', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)

      await recordFailure(tx, CLAIM, action(), {
        status: AiToolInvocationStatus.OUTCOME_UNKNOWN,
        errorCode: 'tool_effect_unknown',
        durationMs: 9,
      })

      expect(tx.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1', status: 'EXECUTING', executionEpoch: 4 },
          data: expect.objectContaining({
            status: 'OUTCOME_UNKNOWN',
            errorCode: 'tool_effect_unknown',
          }),
        })
      )
    })

    it('rolls back when another epoch owns the invocation', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)

      await expect(
        recordFailure(tx, CLAIM, action(), {
          status: AiToolInvocationStatus.FAILED,
          errorCode: 'tool_execution_failed',
          durationMs: 1,
        })
      ).rejects.toBeInstanceOf(RunLeaseLostError)
    })
  })

  describe('applyRejection (exactly once)', () => {
    it('sets appliedAt by CAS and writes the ordering step in the same transaction', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 1 } as never)
      tx.aiRunStep.aggregate.mockResolvedValue({ _max: { stepNumber: 0 } } as never)

      expect(await applyRejection(tx, CLAIM, action({ status: 'REJECTED' as never }), 'tc')).toBe(
        true
      )
      expect(tx.aiToolInvocation.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'inv-1', status: 'REJECTED', appliedAt: null } })
      )
      expect(tx.aiRunStep.create).toHaveBeenCalledTimes(1)
    })

    it('an already-applied rejection writes nothing (no second step)', async () => {
      tx.aiToolInvocation.updateMany.mockResolvedValue({ count: 0 } as never)

      expect(await applyRejection(tx, CLAIM, action(), 'tc')).toBe(false)
      expect(tx.aiRunStep.create).not.toHaveBeenCalled()
    })
  })

  describe('sameAction (one requested action = one invocation)', () => {
    it('matches input independently of prepared arguments without repeating preparation', async () => {
      const parameters = z.json()
      const tool = {
        ...demoSensitiveTool,
        ...fixtureToolContract(parameters),
        parameters,
        toolId: 'archive_document',
        async prepare() {
          return {
            ...(await fixtureToolContract(parameters).prepare({})),
            args: { resolved: 'target' },
          }
        },
      }
      const prepared = await prepareToolIntent(
        tool,
        { a: 1, b: { c: 2, d: 3 } },
        {
          runId: CLAIM.id,
          conversationId: CLAIM.conversationId,
          ownerUserId: 'owner',
          organizationId: null,
          invocationId: 'inv-1',
          idempotencyKey: 'ai-tool:inv-1',
        },
        {} as never,
        1,
        new AiToolContractRegistry([tool], [new FixtureToolAuthority()])
      )
      const existing = action({
        intentHash: prepared.hash,
        intentSnapshot: prepared.intent as unknown as InvocationRow['intentSnapshot'],
      })
      expect(sameAction(existing, 'archive_document', { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
    })

    it('rejects a different tool or different input', () => {
      const existing = action()
      expect(sameAction(existing, 'delete_document', { documentId: 'd1' })).toBe(false)
      expect(sameAction(existing, 'archive_document', { documentId: 'd2' })).toBe(false)
    })
  })
})
