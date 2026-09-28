import { readFile } from 'node:fs/promises'
import { dataAdmission } from './ownership.mjs'
import { targetProof } from './target-proof.mjs'
import { fixtureSql } from './local-sql.mjs'

const invocations = new WeakMap()
async function owner(m) {
  return JSON.parse(await readFile(`${m.worktree}/.amcore/stands/${m.id}/lease/owner.json`, 'utf8'))
}
export async function admitInvocation(m) {
  const held = await owner(m)
  if (held.pid !== process.pid || held.worktree !== m.worktree)
    throw new Error('Invocation requires its own active lease')
  await dataAdmission(m)
  const target = globalThis.structuredClone(m)
  invocations.set(m, { token: held.token, proof: targetProof(m), target })
  await invocationTarget(m)
}
export async function invocationTarget(m) {
  const admitted = invocations.get(m)
  const held = await owner(m)
  if (
    !admitted ||
    targetProof(m) !== admitted.proof ||
    held.token !== admitted.token ||
    held.pid !== process.pid ||
    held.worktree !== m.worktree
  )
    throw new Error('Invocation lease or admitted target changed')
  return globalThis.structuredClone(admitted.target)
}
export async function invocationSql(m, query, variables = {}) {
  return fixtureSql(await invocationTarget(m), query, variables)
}
export function endInvocation(m) {
  invocations.delete(m)
}
