import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { parse } from 'yaml'
import { admitSource } from '../stand/snapshot.mjs'
import { entryMatches } from '../scaffold-selector/paths.mjs'
import { readDeclaration } from '../scaffold-selector/declaration.mjs'

const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
const steps = ci.jobs['docker-image-smoke'].steps

test('runner scan remains unchanged while migrator gets independent coverage', () => {
  const runner = steps.find((step) => step.name === 'Scan the built runner image with Trivy')
  assert.equal(
    runner.run,
    'trivy image \\\n  --severity HIGH,CRITICAL \\\n  --ignore-unfixed \\\n  --format sarif \\\n  --output trivy-results.sarif \\\n  "$AMCORE_API_IMAGE"\n'
  )
  assert.equal(
    steps.find((step) => step.name === 'Upload Trivy SARIF').with.category,
    'trivy-image'
  )
  const migrator = steps.find((step) => step.name === 'Scan the built migrator image with Trivy')
  assert.match(migrator.run, /scan-migrator-image\.mjs/)
  assert.equal(migrator['continue-on-error'], undefined)
  const runnerUpload = steps.findIndex((step) => step.name === 'Upload Trivy SARIF')
  assert.equal(runnerUpload, steps.indexOf(runner) + 1)
  assert.ok(runnerUpload < steps.indexOf(migrator))
  assert.equal(steps[runnerUpload]['continue-on-error'], undefined)
  assert.equal(
    steps.find((step) => step.name === 'Upload migrator Trivy SARIF').with.category,
    'trivy-image-migrator'
  )
  assert.ok(ci.jobs['docker-image-smoke'].needs.includes('lint'))
  assert.match(
    ci.jobs.lint.steps.find((step) => step.name === 'Run ESLint').run,
    /migrator-contract\.mjs/
  )
})

test('nested migrator graph has independent weekly non-major upkeep', () => {
  const updates = parse(readFileSync('.github/dependabot.yml', 'utf8')).updates
  const entry = updates.find((item) => item.directory === '/docker/migrator')
  assert.equal(entry['package-ecosystem'], 'npm')
  assert.equal(entry.schedule.interval, 'weekly')
  assert.ok(
    entry.ignore.some((item) => item['update-types'].includes('version-update:semver-major'))
  )
  assert.ok(updates.some((item) => item.directory === '/' && item['package-ecosystem'] === 'npm'))
})

test('migrator files survive managed snapshots and have generated-full selector coverage', () => {
  const declaration = readDeclaration('scripts/scaffold-selector/declaration.v1.json')
  for (const path of [
    'docker/migrator/package.json',
    'docker/migrator/pnpm-lock.yaml',
    'docker/migrator/pnpm-workspace.yaml',
    'docker/migrator/installer.mjs',
    'docker/migrator/prisma.config.mjs',
    'docker/migrator/connection-options.mjs',
    'docker/migrator/check-connection.sql',
  ]) {
    assert.equal(admitSource(path), true, path)
    assert.ok(
      declaration.inputs.some(
        (input) => input.lane === 'generated-full' && entryMatches(input, path)
      ),
      path
    )
  }
})
