import type { PinoLogger } from 'nestjs-pino'

import type { MemberAccess } from '@amcore/shared'
import { RoleDefinitionErrorCode } from '@amcore/shared'

import { AppException } from '../../../common/exceptions'
import type { PrismaService } from '../../../prisma'
import { CapabilityRegistry } from '../capability-registry.service'

import { AccessUnavailableError } from './access-budget'
import type { AccessCapability } from './access-capabilities'
import { ORDER_UPDATE } from './access-fixtures'
import type { loadAccess } from './access-loader'
import { MemberAccessService } from './member-access.service'

type Loaded = Awaited<ReturnType<typeof loadAccess>>
const loaded = {} as Loaded
const answer = { aclVersion: 1 } as MemberAccess
const warn = jest.fn()
const logger = { setContext: jest.fn(), warn } as unknown as PinoLogger

const catalogueOf = (specs: number): AccessCapability[] => [
  ...Array.from({ length: Math.floor(specs / 5) }, (_, index) => ({
    ...ORDER_UPDATE,
    id: `c${index}`,
    editableFields: ['a', 'b', 'c', 'd'],
  })),
  ...(specs % 5 > 0
    ? [
        {
          ...ORDER_UPDATE,
          id: 'rest',
          editableFields: ['a', 'b', 'c', 'd'].slice(0, (specs % 5) - 1),
        },
      ]
    : []),
]

class Probe extends MemberAccessService {
  loads = 0
  constructor(
    prisma: PrismaService,
    private readonly catalogue: readonly AccessCapability[],
    private readonly built: (capabilities: readonly AccessCapability[]) => MemberAccess = () =>
      answer
  ) {
    super(prisma, new CapabilityRegistry(), logger)
  }
  protected override capabilities(): readonly AccessCapability[] {
    return this.catalogue
  }
  protected override load(): ReturnType<typeof loadAccess> {
    this.loads += 1
    return Promise.resolve(loaded)
  }
  protected override build(
    _loaded: Loaded,
    capabilities: readonly AccessCapability[]
  ): MemberAccess {
    return this.built(capabilities)
  }
}

describe('MemberAccessService refusals', () => {
  const transaction = jest.fn(async (run: (tx: unknown) => unknown) => run({}))
  const prisma = { $transaction: transaction } as unknown as PrismaService
  beforeEach(() => {
    transaction.mockClear()
    warn.mockClear()
  })
  const refused = async (service: MemberAccessService): Promise<AppException> => {
    try {
      await service.explain('o', 'u', 'o')
    } catch (error) {
      return error as AppException
    }
    throw new Error('expected a refusal')
  }

  it('600 specs are answered and the loader is called once', async () => {
    const service = new Probe(prisma, catalogueOf(600))
    await expect(service.explain('o', 'u', 'o')).resolves.toBe(answer)
    expect(service.loads).toBe(1)
  })

  it('601 specs are refused before anything is read or a transaction is opened', async () => {
    const service = new Probe(prisma, catalogueOf(601))
    const error = await refused(service)
    expect(error.getResponse()).toMatchObject({
      errorCode: RoleDefinitionErrorCode.ROLE_ACCESS_UNAVAILABLE,
    })
    expect(service.loads).toBe(0)
    expect(transaction).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'catalogueTooLarge' }),
      'Member access unavailable'
    )
  })

  it.each([
    ['operationBudget', () => new AccessUnavailableError('operationBudget')],
    ['invalidPolicy', () => new AccessUnavailableError('invalidPolicy')],
    ['loadingLimit', () => new AccessUnavailableError('loadingLimit')],
    ['unexpected', () => new Error('boom')],
  ])('logs %s once and answers with the same public code', async (reason, failure) => {
    const service = new Probe(prisma, catalogueOf(5), () => {
      throw failure()
    })
    const error = await refused(service)
    expect(error.getResponse()).toMatchObject({
      errorCode: RoleDefinitionErrorCode.ROLE_ACCESS_UNAVAILABLE,
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason }),
      'Member access unavailable'
    )
    expect(JSON.stringify(error.getResponse())).not.toContain(reason)
  })

  it('an answer above the cap is refused as too large, never shortened', async () => {
    const huge = { ...answer, member: { email: 'x'.repeat(600_000) } } as unknown as MemberAccess
    const service = new Probe(prisma, catalogueOf(5), () => huge)
    await refused(service)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'responseTooLarge' }),
      'Member access unavailable'
    )
  })
})
