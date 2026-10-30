import { appendFileSync } from 'node:fs'
import { invariant } from '../lib/lighthouse-plan.mjs'

const epoch = Number(process.env.AMCORE_CI_EPOCH)
const owner = process.env.AMCORE_AUDIT_JOB_OWNER === 'true'
const end = Math.min(Date.now() + 90_000, epoch + (owner ? 39 : 19.5) * 60_000)
invariant(Number.isSafeInteger(epoch) && end > Date.now(), 'transfer-reserve-exhausted')
for (const [name, offset] of [
  ['E2E', 70_000],
  ['BUNDLE', 20_000],
  ['STATUS', 0],
]) {
  appendFileSync(process.env.GITHUB_ENV, `AMCORE_${name}_TRANSFER_END=${end - offset}\n`)
}
