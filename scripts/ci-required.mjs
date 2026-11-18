import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appendFileSync, readFileSync } from 'node:fs'
import { requireSelectedCi } from './lib/ci-required.mjs'
import { readSelectionSource } from './lib/ci-selection-source.mjs'

try {
  const identity = readSelectionSource(
    process.cwd(),
    process.env.GITHUB_EVENT_NAME,
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    process.env.GITHUB_SHA
  )
  const policy = JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(new URL('./ci-policy.mjs', import.meta.url))], {
      encoding: 'utf8',
    })
  )
  const scope = process.argv[2] ?? 'all'
  const execution = requireSelectedCi(
    JSON.parse(process.env.CI_RESULTS),
    JSON.parse(process.env.CI_PLAN),
    {
      ...identity,
      role: policy.role,
      mode: policy.mode,
      run: process.env.GITHUB_RUN_ID,
      attempt: process.env.GITHUB_RUN_ATTEMPT,
      repository: process.env.GITHUB_REPOSITORY,
      event: process.env.GITHUB_EVENT_NAME,
    },
    scope
  )
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `selected=${execution.reason === 'broad'}\n`)
  console.log(
    `CI ${scope} admission passed: ${execution.reason}; selected jobs succeeded, unselected jobs skipped`
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
