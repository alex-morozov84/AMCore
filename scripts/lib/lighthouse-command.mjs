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
