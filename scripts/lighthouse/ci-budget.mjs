import { appendFileSync } from 'node:fs'
import { invariant } from '../lib/lighthouse-plan.mjs'

const epoch = Number(process.env.AMCORE_CI_EPOCH)
const end = epoch + Number(process.argv[2] ?? 20) * 60_000
const remaining = Math.floor((end - Date.now()) / 60_000)
invariant(Number.isSafeInteger(epoch) && remaining >= 1, 'ci-phase-reserve-exhausted')
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `minutes=${remaining}\n`)
else console.log(remaining)
