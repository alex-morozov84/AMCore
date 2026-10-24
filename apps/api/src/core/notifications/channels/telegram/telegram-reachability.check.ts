import { z } from 'zod'

import { TELEGRAM_REACHABILITY, type TelegramCheckOutcome } from './telegram-reachability.policy.js'
import { readBoundedBody } from './telegram-response-body.js'

export interface TelegramCheckInput {
  /** `TELEGRAM_API_BASE_URL`: the same address the delivery uses, so a relay is checked too. */
  baseUrl: string
  token: string
  /** Process shutdown. When it fires, the check publishes nothing. */
  shutdown: AbortSignal
  fetchImpl?: typeof fetch
}

/** A bot `User` from `getMe`. Nothing from it is kept: it only proves the answer is a real one. */
const getMeSuccessSchema = z.object({
  ok: z.literal(true),
  result: z.object({
    id: z.number().int().positive().refine(Number.isSafeInteger),
    is_bot: z.literal(true),
  }),
})

const failed = (failure: Exclude<TelegramCheckOutcome['failure'], null>): TelegramCheckOutcome => ({
  result: 'failed',
  failure,
})
const unknown = (
  failure: Exclude<TelegramCheckOutcome['failure'], null>
): TelegramCheckOutcome => ({
  result: 'unknown',
  failure,
})

/**
 * One bounded `getMe`. The first step that applies decides: (1) shutdown publishes nothing;
 * (2) a rejected fetch is `timeout` when our own deadline fired, otherwise `unreachable`;
 * (3) a non-2xx answer is classified by its status only and its body is cancelled unread;
 * (4) a 2xx body is read under the byte cap; (5) only a valid bot `User` with no `error_code` is ok.
 * Never throws and never exposes the token-bearing URL or the provider's text.
 */
export async function checkTelegram(
  input: TelegramCheckInput
): Promise<TelegramCheckOutcome | 'shutdown'> {
  if (input.shutdown.aborted) return 'shutdown'
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), TELEGRAM_REACHABILITY.deadlineMs)
  const fetchImpl = input.fetchImpl ?? fetch
  const url = `${input.baseUrl.replace(/\/+$/, '')}/bot${input.token}/getMe`
  try {
    let response: Response
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.any([deadline.signal, input.shutdown]),
      })
    } catch {
      if (input.shutdown.aborted) return 'shutdown'
      return failed(deadline.signal.aborted ? 'timeout' : 'unreachable')
    }
    if (input.shutdown.aborted) {
      await cancelBody(response)
      return 'shutdown'
    }
    if (response.status < 200 || response.status >= 300) {
      await cancelBody(response)
      // Shutdown is re-checked after every await: it may arrive while the body is cancelled.
      if (input.shutdown.aborted) return 'shutdown'
      return classifyStatus(response.status)
    }
    const body = await readBoundedBody(response)
    if (input.shutdown.aborted) return 'shutdown'
    if (deadline.signal.aborted) return failed('timeout')
    if ('error' in body) return unknown('invalid_response')
    return isGetMeSuccess(body.text) ? { result: 'ok', failure: null } : unknown('invalid_response')
  } finally {
    clearTimeout(timer)
  }
}

/** A non-2xx answer by its status alone: the body never changes the classification. */
export function classifyStatus(status: number): TelegramCheckOutcome {
  if (status === 401) return failed('auth_rejected')
  if (status === 429) return unknown('rate_limited')
  if (status === 408 || status >= 500) return unknown('provider_error')
  if (status >= 400) return failed('request_rejected')
  return unknown('unexpected_response')
}

function isGetMeSuccess(text: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null || 'error_code' in parsed) return false
  return getMeSuccessSchema.safeParse(parsed).success
}

/** Release an unread body without letting a slow peer hold the check slot. */
async function cancelBody(response: Response): Promise<void> {
  if (!response.body) return
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    response.body.cancel().catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, TELEGRAM_REACHABILITY.bodyCancelMs)
    }),
  ])
  clearTimeout(timer)
}
