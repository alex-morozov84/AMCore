import { readFileSync } from 'node:fs'
import { requireBridgeCi } from './lib/ci-required.mjs'
import { readSelectionSource } from './lib/ci-selection-source.mjs'

try {
  const identity = readSelectionSource(
    process.cwd(),
    process.env.GITHUB_EVENT_NAME,
    JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')),
    process.env.GITHUB_SHA
  )
  requireBridgeCi(JSON.parse(process.env.CI_RESULTS), JSON.parse(process.env.CI_PLAN), {
    ...identity,
    run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    repository: process.env.GITHUB_REPOSITORY,
    event: process.env.GITHUB_EVENT_NAME,
  })
  console.log('Every required CI job succeeded, including Web E2E and Storybook')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
