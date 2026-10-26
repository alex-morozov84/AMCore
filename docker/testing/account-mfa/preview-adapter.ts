import { verify } from 'otplib'

import {
  AuthErrorCode,
  type MfaBrowserResult,
  type MfaBrowserView,
  type MfaProof,
} from '@amcore/shared'

import type { AccountMfaAdapter } from '@/features/account-mfa'
import { ApiRequestError } from '@/shared/api/http-client'

export type Scenario =
  | 'setup'
  | 'login'
  | 'last_code'
  | 'settings'
  | 'unknown'
  | 'expired'
  | 'password_setup'
  | 'emergency'
type Flow = Extract<MfaBrowserView, { kind: 'flow' }>
const PUBLIC_SEED = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // gitleaks:allow -- public RFC6238 test vector
const demoCodes = (generation = 0) =>
  Array.from({ length: 10 }, (_, index) =>
    (generation * 100 + index + 1).toString(16).padStart(32, '0').match(/.{4}/g)!.join('-')
  )
export const DEMO_CODES = demoCodes()
const accountLabel = 'demo.operator@preview.amcore.test'

/** UI-only simulation copied into an owned preview. It never writes account MFA or grants access. */
export function previewAdapter(scenario: Scenario): AccountMfaAdapter & { settings(): void } {
  const available = new Set(scenario === 'last_code' ? DEMO_CODES.slice(0, 1) : DEMO_CODES)
  let primaryAt = scenario === 'unknown' ? Date.now() : 0
  let factorAt = 0
  const fresh = (at: number) => Date.now() - at <= 10 * 60_000
  let generation = 0
  let view: MfaBrowserView = { kind: 'unavailable' }
  let loseResponse = scenario === 'unknown'
  const settings = (protectedAccount = true) => ({
    kind: 'settings' as const,
    accountLabel,
    protected: protectedAccount,
    eligible: true,
    remainingCodes: available.size,
  })
  const flow = (purpose: Flow['purpose'], state: Flow['state']): Flow => ({
    kind: 'flow',
    accountLabel,
    purpose,
    state,
    generation,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    requiredProofs: [],
    remainingCodes: available.size,
  })
  const move = (state: Flow['state']) => {
    if (view.kind !== 'flow') throw new Error('DEMO_FLOW_REQUIRED')
    view = flow(view.purpose, state)
    return view
  }
  const check = async (proof: MfaProof | undefined) => {
    const valid =
      proof?.method === 'totp'
        ? (
            await verify({
              secret: PUBLIC_SEED,
              token: proof.code,
              algorithm: 'sha1',
              digits: 6,
              period: 30,
              epochTolerance: 30,
            })
          ).valid
        : proof?.method === 'recovery_code' && available.delete(proof.code)
    if (!valid)
      throw new ApiRequestError(400, {
        statusCode: 400,
        errorCode: AuthErrorCode.MFA_INVALID_PROOF,
        message: 'Demo proof rejected',
        timestamp: new Date().toISOString(),
        path: '/demo',
        method: 'POST',
      })
    factorAt = Date.now()
  }
  const codes = (): MfaBrowserResult => {
    generation++
    available.clear()
    const next = demoCodes(generation)
    next.forEach((code) => available.add(code))
    return { view: move('codes_pending'), backupCodes: { codes: next, generation } }
  }
  if (scenario === 'password_setup') view = { kind: 'password_setup_required', accountLabel }
  else if (scenario === 'emergency') view = { kind: 'recovery_ticket', accountLabel }
  else if (scenario === 'setup') view = settings(false)
  else if (scenario === 'settings') view = settings()
  else
    view = flow(
      'login',
      scenario === 'expired'
        ? 'expired'
        : scenario === 'unknown'
          ? 'verify_required'
          : 'password_required'
    )
  return {
    inspect: async () => view,
    settings: () => {
      view = settings()
    },
    command: async (input) => {
      if (input.action === 'start_recovery') view = { kind: 'recovery_ticket', accountLabel }
      else if (input.action === 'redeem_recovery_ticket') {
        if (!input.password || input.ticket !== 'x'.repeat(43))
          throw new ApiRequestError(400, {
            statusCode: 400,
            errorCode: AuthErrorCode.MFA_RECOVERY_TICKET_INVALID,
            message: 'Demo proof rejected',
            timestamp: '',
            path: '/demo',
            method: 'POST',
          })
        view = flow('initial_setup', 'enrollment_required')
      } else if (input.action === 'start_setup') view = flow('initial_setup', 'password_required')
      else if (input.action === 'start_code_rotation')
        view = flow(
          'rotate_codes',
          fresh(primaryAt) ? (fresh(factorAt) ? 'ready' : 'verify_required') : 'password_required'
        )
      else if (input.action === 'start_replacement')
        view = flow(
          'replace_factor',
          fresh(primaryAt)
            ? fresh(factorAt)
              ? 'enrollment_required'
              : 'verify_required'
            : 'password_required'
        )
      else if (input.action === 'confirm_password') {
        primaryAt = Date.now()
        move(
          view.kind === 'flow' && view.purpose === 'initial_setup'
            ? 'enrollment_required'
            : 'verify_required'
        )
      } else if (input.action === 'start_enrollment')
        return {
          view: move('enrollment_required'),
          enrollment: {
            secret: PUBLIC_SEED,
            otpauthUri: `otpauth://totp/AMCore%20demo:${accountLabel}?secret=${PUBLIC_SEED}&issuer=AMCore%20demo&algorithm=SHA1&digits=6&period=30`,
          },
        }
      else if (input.action === 'verify' || input.action === 'recover_codes') {
        if (
          input.action === 'recover_codes' &&
          view.kind === 'flow' &&
          view.purpose === 'rotate_codes' &&
          fresh(primaryAt) &&
          fresh(factorAt)
        )
          return codes()
        await check(input.proof)
        if (
          view.kind === 'flow' &&
          (view.state === 'enrollment_required' || input.action === 'recover_codes')
        )
          return codes()
        move(
          view.kind === 'flow' && view.purpose === 'replace_factor'
            ? 'enrollment_required'
            : view.kind === 'flow' && view.purpose === 'rotate_codes'
              ? 'ready'
              : 'completed'
        )
        if (loseResponse) {
          loseResponse = false
          throw new TypeError('Simulated response loss')
        }
      } else if (input.action === 'rotate_codes') return codes()
      else if (
        input.action === 'acknowledge_codes' ||
        input.action === 'complete_login' ||
        input.action === 'complete_confirmation'
      )
        move('completed')
      else if (input.action === 'cancel') move('cancelled')
      return { view }
    },
  }
}
