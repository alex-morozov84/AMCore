import { requireCompleteCi } from './lib/ci-required.mjs'

try {
  requireCompleteCi(JSON.parse(process.env.CI_RESULTS))
  console.log('Every required CI job succeeded, including Web E2E and Storybook')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
