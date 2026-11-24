import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { prProof, resolveDeliveryProof } from './lib/ci-delivery-proof.mjs'
import { githubEvidence } from './lib/ci-delivery-api.mjs'
import { requireSelectedCi } from './lib/ci-required.mjs'
import { readSelectionSource } from './lib/ci-selection-source.mjs'

try {
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const identity = readSelectionSource(
    process.cwd(),
    process.env.GITHUB_EVENT_NAME,
    payload,
    process.env.GITHUB_SHA
  )
  const policy = JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(new URL('./ci-policy.mjs', import.meta.url))], {
      encoding: 'utf8',
    })
  )
  const scope = process.argv[2] ?? 'all'
  const plan = JSON.parse(process.env.CI_PLAN)
  const api = githubEvidence(process.env, policy.repository)
  const repositoryId = process.env.GITHUB_REPOSITORY_ID
  if (plan.inputs?.credit && api) {
    const delivery = await resolveDeliveryProof(
      process.cwd(),
      { ...identity, policy, payload, repositoryId },
      api
    )
    identity.credit = delivery.credit
  }
  const execution = requireSelectedCi(
    JSON.parse(process.env.CI_RESULTS),
    plan,
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
  if (scope === 'all' && policy.event === 'pull_request' && process.env.CI_PROOF_PATH) {
    writeFileSync(
      process.env.CI_PROOF_PATH,
      JSON.stringify(prProof(process.cwd(), payload, plan, repositoryId))
    )
  }
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `selected=${execution.effective.includes('api-e2e')}\n`
    )
  console.log(
    `CI ${scope} admission passed: ${execution.reason}; selected jobs succeeded, unselected jobs skipped`
  )
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
