import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'

const template = parse(readFileSync('.github/workflows/deploy-template.yml', 'utf8'))
const builds = template.jobs.build.steps.filter((step) =>
  step.uses?.startsWith('docker/build-push-action@')
)

// MFA deployment preflight refuses an artifact without the full source commit, and the
// web artifact takes it from this build argument (apps/web/Dockerfile). A build step
// without it publishes an image no deployment can admit.
test('every image build in the deploy template receives the full source commit', () => {
  assert.deepEqual(
    builds.map((step) => step.id),
    ['push-api', 'push-api-migrator', 'push-web']
  )
  for (const step of builds) {
    assert.match(
      step.with['build-args'],
      /(^|\n)BUILD_SOURCE_COMMIT=\$\{\{ github\.sha \}\}(\n|$)/,
      `${step.id} must pass BUILD_SOURCE_COMMIT=\${{ github.sha }}`
    )
  }
})
