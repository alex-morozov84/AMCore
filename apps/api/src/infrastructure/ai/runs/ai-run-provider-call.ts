import type { AiGenerateRequest, AiTextResult } from '../gateway/ai-gateway.types'
import type { ModelGateway } from '../gateway/model-gateway.service'

import type { ClaimedRun } from './ai-run-dispatch.types'

import type { AttemptRuntime } from '@/infrastructure/worker-lifecycle'

/** Why a provider call was aborted by the caller: the worker is shutting down, or the run lifetime ended. */
export type AiRunStopSignal = 'shutdown' | 'deadline'

/** Grace beyond the gateway's own timeout before the local wait gives up on an adapter ignoring abort. */
const PROVIDER_LOCAL_BOUND_GRACE_MS = 2000

/** The local wait bound elapsed although the gateway's own timeout should have fired (a last-resort backstop). */
export class ProviderCallBoundError extends Error {
  constructor() {
    super('provider call exceeded the local wait bound')
    this.name = 'ProviderCallBoundError'
  }
}

/**
 * One provider call with the run's lifetime and the worker shutdown folded into the gateway abort signal
 * (`min(call timeout, deadline − now)` ∪ seal). The physical call is registered with the lane's runtime,
 * so its capacity slot stays reserved until it really settles; a local race bounds the WAIT even when an
 * adapter ignores abort. Cancellation is cooperative — forwarding a signal never proves the remote stopped.
 */
export async function callProvider(
  gateway: ModelGateway,
  request: Omit<AiGenerateRequest, 'abortSignal'>,
  ctx: { claim: ClaimedRun; runtime: AttemptRuntime; timeoutMs: number }
): Promise<AiTextResult> {
  const signals = [ctx.runtime.attempt.signal]
  if (ctx.claim.deadlineAt !== null) {
    signals.push(AbortSignal.timeout(Math.max(0, ctx.claim.deadlineAt.getTime() - Date.now())))
  }
  const call = gateway.generateText({ ...request, abortSignal: AbortSignal.any(signals) })
  ctx.runtime.onTransportStarted(call)
  let timer: NodeJS.Timeout | undefined
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ProviderCallBoundError()),
      ctx.timeoutMs + PROVIDER_LOCAL_BOUND_GRACE_MS
    )
  })
  try {
    return await Promise.race([call, bound])
  } finally {
    clearTimeout(timer)
  }
}

/** Which caller abort fired: a sealed shutdown latch aborts the attempt signal; otherwise the deadline did. */
export function abortCause(runtime: AttemptRuntime): AiRunStopSignal {
  return runtime.attempt.signal.aborted ? 'shutdown' : 'deadline'
}
