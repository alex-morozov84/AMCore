import { invariant } from './lighthouse-plan.mjs'

export function auditCommand(plan, lane, id, reuse = false) {
  invariant(plan.assignments[lane]?.length, 'select-an-audit-owning-lane')
  let standLane = lane === 'staff-oauth' ? 'product-admin-real-stack' : 'real-stack'
  // AMCORE_CONSOLE_LIGHTHOUSE_LOCAL_START
  if (lane === 'host') standLane = 'console-real-stack'
  // AMCORE_CONSOLE_LIGHTHOUSE_LOCAL_END
  const args = ['scripts/stand.mjs', 'e2e', '--lane', standLane, '--audit-only', '--id', id]
  if (lane === 'staff-oauth') args.push('--fixture', 'product-admin-oauth')
  if (reuse) args.push('--reuse-audit')
  return args
}

export function auditEnvironment(plan, lane, epoch, output) {
  return {
    AMCORE_AUDIT_PLAN: JSON.stringify(plan),
    AMCORE_AUDIT_OWNER: lane,
    AMCORE_AUDIT_EPOCH: String(epoch),
    AMCORE_AUDIT_OUTPUT: output,
  }
}

export function laneEpoch(hostedEpoch, began) {
  const epoch = hostedEpoch === undefined ? began : Number(hostedEpoch)
  invariant(Number.isSafeInteger(epoch) && epoch > 0 && epoch <= began, 'invalid-job-epoch')
  return epoch
}
