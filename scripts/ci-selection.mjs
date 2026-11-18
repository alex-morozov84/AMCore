import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { normalizeCiAreas } from './lib/ci-selection.mjs'
import { readSelectionSource } from './lib/ci-selection-source.mjs'
import { coarseExecution } from './lib/ci-required.mjs'
import { LOCALE_CATALOGUES } from './lib/settings-files.mjs'

try {
  const policy = JSON.parse(
    execFileSync(process.execPath, [fileURLToPath(new URL('./ci-policy.mjs', import.meta.url))], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  )
  if (policy.role !== 'upstream-starter' || policy.mode === 'heavy-off')
    throw new Error('Broad bridge supports upstream normal/full only')
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const acquired = readSelectionSource(process.cwd(), policy.event, payload, process.env.GITHUB_SHA)
  const cataloguePath = 'packages/shared/src/constants/locales.ts'
  const catalogueAt = (sha) =>
    execFileSync('git', ['show', `${sha}:${cataloguePath}`], { encoding: 'utf8' })
  const sourceCatalogue = catalogueAt(acquired.source.head)
  if (
    !acquired.source.base ||
    sourceCatalogue !==
      readFileSync(
        new URL('../packages/shared/src/constants/locales.ts', import.meta.url),
        'utf8'
      ) ||
    sourceCatalogue !== catalogueAt(acquired.source.base)
  )
    throw new Error('Broad bridge requires the unchanged source/checkout catalogue definition')
  const expected = {
    'locales.json': { version: 1, enabled: LOCALE_CATALOGUES, default: 'en' },
    'admin-console.json': { version: 1, mode: 'path', alias: 'admin' },
    'product-admin.json': { version: 1, mode: 'path', alias: 'manage' },
  }
  for (const [file, settings] of Object.entries(expected)) {
    const actual = JSON.parse(
      execFileSync('git', ['show', `${policy.source.head}:packages/shared/src/config/${file}`], {
        encoding: 'utf8',
      })
    )
    if (!isDeepStrictEqual(actual, settings))
      throw new Error('Broad bridge supports source S0 only; native settings are not prepared')
  }
  const outputs = JSON.parse(process.env.CI_FILTER_OUTPUTS)
  const areas = normalizeCiAreas(outputs)
  // Git ancestry is admitted above. REST completeness and fork permissions remain unproved here.
  const inputs = {
    role: policy.role,
    mode: policy.mode,
    areas,
    diffComplete: acquired.diffComplete,
    integration: acquired.integration,
  }
  const execution = coarseExecution(inputs)
  if (
    !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '')
  )
    throw new Error('Selection requires a run and attempt identity')
  const plan = {
    run: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    version: 2,
    phase: 'coarse',
    repository: policy.repository,
    event: policy.event,
    source: acquired.source,
    inputs,
    ...execution,
  }
  const json = JSON.stringify(plan)
  if (process.env.GITHUB_OUTPUT) {
    const selected = execution.reason === 'broad'
    appendFileSync(process.env.GITHUB_OUTPUT, `plan=${json}\nserver=${selected}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## CI execution selection\nReason: ${execution.reason}. Selected groups: ${execution.effective.length}/18.\n\n\`\`\`json\n${json}\n\`\`\`\n`
    )
  console.log(json)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
