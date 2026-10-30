import { randomUUID } from 'node:crypto'

import {
  mfaReauthenticationResultSchema,
  mfaSessionFlowResultSchema,
  type MfaStepUpCommand,
  type MfaStepUpPending,
  mfaVerificationResultSchema,
} from '@amcore/shared'
import { z } from 'zod'

import { fetchBackendResponse, getBackendBaseUrl } from '../backend-transport'
import { parseRetryAfterSeconds } from '../retry-after'

import { changedBrowserContext, unavailableBrowserContext } from './browser-binding.server'
import { readContextJson } from './context-body-budget'
import { ContextRequestError } from './context-errors'
import { getWebRedisClient } from './redis-client'

import 'server-only'

export interface MfaSourceSession {
  token: string
  bindingHeaders: Record<string, string>
  sourceFingerprint?: string
}
const recordSchema = z
  .object({
    continuation: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime(),
    completionId: z.string().uuid(),
  })
  .strict()
const key = (id: string) => `web:mfa-source-operation:v1:${z.string().uuid().parse(id)}`

async function post(
  request: Request,
  source: MfaSourceSession,
  path: 'session-flow' | 'verify' | 'reauthenticate',
  body: unknown,
  continuation?: string
) {
  const response = await fetchBackendResponse(
    `${getBackendBaseUrl()}/api/v1/auth/mfa/${path}`,
    request.headers,
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...source.bindingHeaders,
        'content-type': 'application/json',
        ...(continuation
          ? { 'x-mfa-continuation': continuation }
          : { authorization: `Bearer ${source.token}` }),
      },
      body: JSON.stringify(body),
    }
  )
  if (response.status === 401 || response.status === 409) throw changedBrowserContext()
  if (response.status === 429)
    throw new ContextRequestError(
      429,
      'RATE_LIMIT_EXCEEDED',
      parseRetryAfterSeconds(response.headers)
    )
  if (!response.ok) throw unavailableBrowserContext()
  return readContextJson(response.body, 16384)
}

/** Private continuation is bound to the selected vault, original family, browser generation and anchor. */
export async function startSourceReauthentication(
  request: Request,
  source: MfaSourceSession
): Promise<MfaStepUpPending> {
  if (!source.sourceFingerprint) throw changedBrowserContext()
  const result = mfaSessionFlowResultSchema.parse(
    await post(request, source, 'session-flow', {
      purpose: 'reauthenticate',
      operationId: randomUUID(),
    })
  )
  if (result.kind === 'limited')
    throw new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', result.retryAfter)
  if (result.kind === 'restart_required') throw changedBrowserContext()
  if (result.kind !== 'mfa') throw unavailableBrowserContext()
  const flowBinding = randomUUID()
  const expiresAt = new Date(
    Math.min(Date.parse(result.expiresAt), Date.now() + 300000)
  ).toISOString()
  const record = recordSchema.parse({
    continuation: result.continuation,
    sourceFingerprint: source.sourceFingerprint,
    completionId: randomUUID(),
    expiresAt,
  })
  const saved = await (
    await getWebRedisClient()
  ).set(key(flowBinding), JSON.stringify(record), {
    condition: 'NX',
    expiration: { type: 'PXAT', value: Date.parse(expiresAt) },
  })
  if (saved !== 'OK') throw unavailableBrowserContext()
  return { kind: 'proof_required', flowBinding, expiresAt, requiredProofs: result.requiredProofs }
}

/** A completion retry never renews proof timestamps or selects a newer source family. */
export async function completeSourceReauthentication(
  request: Request,
  source: MfaSourceSession,
  command: MfaStepUpCommand
): Promise<void | MfaStepUpPending> {
  const raw = await (await getWebRedisClient()).get(key(command.flowBinding))
  const record = raw ? recordSchema.safeParse(JSON.parse(raw)) : null
  if (
    !record?.success ||
    !source.sourceFingerprint ||
    record.data.sourceFingerprint !== source.sourceFingerprint ||
    Date.parse(record.data.expiresAt) <= Date.now()
  )
    throw changedBrowserContext()
  const pending = (requiredProofs: MfaStepUpPending['requiredProofs']): MfaStepUpPending => ({
    kind: 'proof_required',
    flowBinding: command.flowBinding,
    expiresAt: record.data.expiresAt,
    requiredProofs,
  })
  if (command.proof) {
    const verified = mfaVerificationResultSchema.parse(
      await post(
        request,
        source,
        'verify',
        {
          purpose: 'reauthenticate',
          operationId: command.operationId,
          proof: command.proof,
        },
        record.data.continuation
      )
    )
    if (verified.outcome === 'wrong_code') throw new ContextRequestError(422, 'MFA_INVALID_PROOF')
    if (verified.outcome === 'limited')
      throw new ContextRequestError(429, 'RATE_LIMIT_EXCEEDED', verified.retryAfter)
    if (verified.outcome === 'restart_required' || verified.outcome === 'attempts_exhausted')
      throw changedBrowserContext()
    if (verified.outcome === 'unavailable') throw unavailableBrowserContext()
    if (verified.outcome === 'proof_required') return pending(verified.requiredProofs ?? [])
  }
  const result = mfaReauthenticationResultSchema.parse(
    await post(
      request,
      source,
      'reauthenticate',
      {
        purpose: 'reauthenticate',
        operationId: record.data.completionId,
      },
      record.data.continuation
    )
  )
  if (result.outcome === 'completed') return
  if (result.outcome === 'proof_required') return pending(result.requiredProofs)
  if (result.outcome === 'restart_required') throw changedBrowserContext()
  throw unavailableBrowserContext()
}
