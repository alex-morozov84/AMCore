import { ACCESS_MAX_OPERATIONS } from '@amcore/shared'

/**
 * Why an explanation could not be produced. The HTTP answer is always the same
 * `ROLE_ACCESS_UNAVAILABLE`; the reason is internal (logged once, asserted in tests) so it can never
 * become a probing channel.
 */
export type AccessUnavailableReason =
  | 'catalogueTooLarge'
  | 'loadingLimit'
  | 'operationBudget'
  | 'responseTooLarge'
  | 'invalidPolicy'
  | 'unexpected'

export class AccessUnavailableError extends Error {
  constructor(
    readonly reason: AccessUnavailableReason,
    readonly category?: AccessOperationCategory
  ) {
    super(`Member access unavailable: ${reason}`)
  }
}

export type AccessOperationCategory =
  'relevance' | 'prerequisite' | 'mask' | 'canonical' | 'aggregate'

/**
 * Every internal check pays here before it runs, so work that is not counted cannot exist. Passing
 * the limit aborts the whole request; there is never a partial answer.
 */
export class AccessOperationBudget {
  private spentTotal = 0
  private readonly byCategory = new Map<AccessOperationCategory, number>()

  constructor(readonly limit: number = ACCESS_MAX_OPERATIONS) {}

  spend(units: number, category: AccessOperationCategory): void {
    this.spentTotal += units
    this.byCategory.set(category, (this.byCategory.get(category) ?? 0) + units)
    if (this.spentTotal > this.limit) throw new AccessUnavailableError('operationBudget', category)
  }

  get spent(): number {
    return this.spentTotal
  }

  spentIn(category: AccessOperationCategory): number {
    return this.byCategory.get(category) ?? 0
  }
}
