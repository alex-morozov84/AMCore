/** One interval contract for provider-window admission, transport and cooldown. */
export const PROVIDER_WINDOW_CLOCK = Object.freeze({
  version: 1,
  timestampErrorBoundMs: 2000,
  providerDedupHorizonMs: 86_400_000,
  maxFenceAgeMs: 1000,
  maxPgSampleAgeMs: 1000,
  maxDualClockDisagreementMs: 200,
  maxSchedulingAfterCheckMs: 1000,
  maxTransportLifetimeMs: 30_000,
  reservedSafetyMarginMs: 59_000,
})

const clock = PROVIDER_WINDOW_CLOCK
export type RetryAfterConstraint =
  | { readonly kind: 'duration'; readonly milliseconds: number }
  | { readonly kind: 'absolute'; readonly timestamp: number }
  | { readonly kind: 'unsupported' }
export const HORIZON_CHECK_OVERHEAD_MS =
  2 * clock.timestampErrorBoundMs +
  clock.maxSchedulingAfterCheckMs +
  clock.maxTransportLifetimeMs +
  clock.reservedSafetyMarginMs

function checked(...values: number[]): void {
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0))
    throw new Error('CLOCK_UNCERTAIN')
}

export function latestRetryFloor(
  previous: number,
  receivedPgTime: number,
  delayMs: number
): number {
  const delay = Math.ceil(delayMs)
  checked(previous, receivedPgTime, delay)
  const floor = Math.max(previous, receivedPgTime + clock.timestampErrorBoundMs + delay)
  checked(floor)
  return floor
}

export function constrainedRetryFloor(
  previous: number,
  receivedPgTime: number,
  constraint: Exclude<RetryAfterConstraint, { kind: 'unsupported' }>
): number {
  if (constraint.kind === 'duration')
    return latestRetryFloor(previous, receivedPgTime, constraint.milliseconds)
  checked(previous, receivedPgTime, constraint.timestamp)
  const upper = constraint.timestamp + clock.timestampErrorBoundMs
  const receivedUpper = receivedPgTime + clock.timestampErrorBoundMs
  checked(upper, receivedUpper)
  return Math.max(previous, receivedUpper, upper)
}

export function floorEligible(sample: number, floorUpper: number): boolean {
  checked(sample, floorUpper)
  return sample - clock.timestampErrorBoundMs >= floorUpper
}

export interface TransportFence {
  readonly redisTime: number
  readonly wallTime: number
  readonly monotonicElapsedMs: number
  readonly wallElapsedMs: number
  readonly pgSampleAgeMs: number
  readonly nominalDeadline: number
  readonly floorUpper: number
}

/** Call synchronously at the transport seam; a successful Redis reply alone is insufficient. */
export function transportFenceEligible(fence: TransportFence): boolean {
  const monotonic = Math.ceil(fence.monotonicElapsedMs)
  const wall = Math.ceil(fence.wallElapsedMs)
  const pgAge = Math.ceil(fence.pgSampleAgeMs)
  checked(
    fence.redisTime,
    fence.wallTime,
    monotonic,
    wall,
    pgAge,
    fence.nominalDeadline,
    fence.floorUpper
  )
  if (Math.abs(monotonic - wall) > clock.maxDualClockDisagreementMs) return false
  const elapsed = Math.max(monotonic, wall)
  if (elapsed > clock.maxFenceAgeMs || pgAge > clock.maxPgSampleAgeMs) return false
  const now = Math.max(fence.redisTime + elapsed, fence.wallTime)
  checked(now + HORIZON_CHECK_OVERHEAD_MS)
  return (
    floorEligible(fence.wallTime, fence.floorUpper) &&
    floorEligible(fence.redisTime, fence.floorUpper) &&
    now + HORIZON_CHECK_OVERHEAD_MS < fence.nominalDeadline
  )
}
