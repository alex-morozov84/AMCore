import { invariant } from './lighthouse-plan.mjs'

export const durations = {
  preAudit: 20 * 60_000,
  audit: 15 * 60_000,
  case: 90_000,
  export: 30_000,
  terminate: 30_000,
  cleanup: 120_000,
  transfer: 90_000,
}
// The final minute belongs to status generation and action post steps.
export function laneJobMinutes(owner) {
  const work = durations.preAudit + (owner ? durations.audit : 0)
  return (work + durations.terminate + durations.cleanup + durations.transfer) / 60_000 + 1
}
export function standDeadline(epoch, phase, owner, now = Date.now()) {
  invariant(Number.isSafeInteger(epoch) && epoch > 0 && epoch <= now, 'invalid-job-epoch')
  if (phase === 'prepare') return epoch + durations.preAudit
  const work = durations.preAudit + (owner ? durations.audit : 0)
  if (phase === 'terminate')
    return Math.min(now + durations.terminate, epoch + work + durations.terminate)
  invariant(phase === 'cleanup', 'unknown-stand-phase')
  return Math.min(now + durations.cleanup, epoch + work + durations.terminate + durations.cleanup)
}
export function phaseDeadline(epoch, now = Date.now()) {
  invariant(Number.isSafeInteger(epoch) && epoch > 0 && epoch <= now, 'invalid-job-epoch')
  invariant(now <= epoch + durations.preAudit, 'pre-audit-deadline-exhausted')
  return Math.min(now + durations.audit, epoch + durations.preAudit + durations.audit)
}
export function admitCase(deadline, now = Date.now()) {
  invariant(deadline - now >= durations.case + durations.export, 'audit-phase-reserve-exhausted')
  return Math.min(now + durations.case, deadline - durations.export)
}
export async function boundedCase(run, stop, deadline, now = Date.now) {
  const remaining = deadline - now()
  invariant(remaining > 0, 'case-deadline-exhausted')
  let timer
  let expired = false
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(new Error('audit-case-timeout'))
    }, remaining)
  })
  try {
    return await Promise.race([run(), timeout])
  } finally {
    globalThis.clearTimeout(timer)
    await stop(expired)
  }
}
