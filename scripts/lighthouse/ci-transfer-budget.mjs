import { durations, laneJobMinutes } from '../lib/lighthouse-deadlines.mjs'
import { appendFileSync } from 'node:fs'
import { invariant } from '../lib/lighthouse-plan.mjs'

const epoch = Number(process.env.AMCORE_CI_EPOCH)
const owner = process.env.AMCORE_AUDIT_JOB_OWNER === 'true'
const now = Date.now()
const end = now + durations.transfer
invariant(
  Number.isSafeInteger(epoch) &&
    epoch > 0 &&
    epoch <= now &&
    end <= epoch + (laneJobMinutes(owner) - 1) * 60_000,
  'transfer-reserve-exhausted'
)
for (const [name, offset] of [
  ['E2E', 70_000],
  ['BUNDLE', 20_000],
  ['STATUS', 0],
]) {
  appendFileSync(process.env.GITHUB_ENV, `AMCORE_${name}_TRANSFER_END=${end - offset}\n`)
}
