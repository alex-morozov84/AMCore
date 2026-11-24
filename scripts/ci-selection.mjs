import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { normalizeCiAreas } from './lib/ci-selection.mjs'
import { readSelectionSource } from './lib/ci-selection-source.mjs'
import { requireBrowserTestOwner } from './e2e-ci-plan.mjs'
import { inheritedBrowserChanges } from './lib/inherited-browser-changes.mjs'
import { coarseExecution } from './lib/ci-required.mjs'

try {
  const policy = JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(new URL('./ci-policy.mjs', import.meta.url))], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  )
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const acquired = readSelectionSource(process.cwd(), policy.event, payload, process.env.GITHUB_SHA)
  if (policy.mode !== 'heavy-off' && policy.role === 'downstream-product') {
    const inherited = new Set(
      acquired.integration
        ? inheritedBrowserChanges(process.cwd(), acquired.source, acquired.changedFiles)
        : []
    )
    const productFiles = acquired.changedFiles.filter((file) => !inherited.has(file))
    requireBrowserTestOwner(process.cwd(), productFiles, policy.role)
  }
  let areas = {}
  const classifierChanged = acquired.changedFiles.some((file) =>
    /^(?:\.github\/(?:ci-paths\.yml|workflows\/|actions\/)|scripts\/(?:lib\/)?ci-)/.test(file)
  )
  let diffComplete = acquired.diffComplete && !classifierChanged
  if (diffComplete) {
    try {
      const outputs = JSON.parse(process.env.CI_FILTER_OUTPUTS)
      const all = JSON.parse(outputs.all_files ?? '[]')
      diffComplete = isDeepStrictEqual([...all].sort(), acquired.changedFiles)
      if (diffComplete) areas = normalizeCiAreas(outputs)
    } catch {
      diffComplete = false
    }
  }
  for (const file of acquired.changedFiles)
    if (
      file.startsWith('apps/api/') &&
      /\.e2e-spec\.[cm]?[jt]sx?$/.test(file) &&
      !(file.startsWith('apps/api/test/') && file.endsWith('.e2e-spec.ts')) &&
      existsSync(file)
    )
      throw new Error(`Unsupported API E2E test placement: ${file}`)
  // Incomplete classification can add work, never remove it.
  const inputs = {
    role: policy.role,
    mode: policy.mode,
    areas,
    diffComplete,
    integration: acquired.integration,
  }
  const execution = coarseExecution(inputs, policy.event)
  if (
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('Selection requires a run and attempt identity')
  const plan = {
    run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    version: 3,
    phase: 'selection',
    repository: policy.repository,
    event: policy.event,
    source: acquired.source,
    inputs,
    ...execution,
  }
  const json = JSON.stringify(plan)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `plan=${json}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## CI execution selection\nReason: ${execution.reason}. Selected groups: ${execution.effective.length}.\n\n\`\`\`json\n${json}\n\`\`\`\n`
    )
  console.log(json)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
