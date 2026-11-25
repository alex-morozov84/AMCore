import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { classifyCiChange } from './lib/ci-classification.mjs'
import { readSelectionSource } from './lib/ci-selection-source.mjs'
import { requireBrowserTestOwner } from './e2e-ci-plan.mjs'
import { inheritedBrowserChanges } from './lib/inherited-browser-changes.mjs'
import { resolveDeliveryProof } from './lib/ci-delivery-proof.mjs'
import { githubEvidence } from './lib/ci-delivery-api.mjs'
import { coarseExecution, requiredCiJobs } from './lib/ci-required.mjs'

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
  const classification = classifyCiChange(acquired, process.env.CI_FILTER_OUTPUTS)
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
    ...classification,
    integration: acquired.integration,
  }
  const api = githubEvidence(process.env, policy.repository)
  const delivery =
    api && policy.event === 'push'
      ? await resolveDeliveryProof(
          process.cwd(),
          {
            ...acquired,
            classification,
            policy,
            payload,
            repositoryId: process.env.GITHUB_REPOSITORY_ID,
          },
          api
        )
      : policy.event === 'push'
        ? { reason: 'GitHub evidence access is unavailable' }
        : {}
  if (delivery.credit) inputs.credit = delivery.credit
  if (delivery.reason) console.error(`CI delivery: ${delivery.reason}; running applicable checks`)
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
  const credit = inputs.credit
  const deliverySummary = credit
    ? `Credited PR #${credit.pull}: [run ${credit.run}, attempt ${credit.attempt}](${process.env.GITHUB_SERVER_URL}/${policy.repository}/actions/runs/${credit.run}/attempts/${credit.attempt}).`
    : (delivery.reason ?? '')
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `plan=${json}\ncomparison-base=${acquired.baseExists ? acquired.source.base : ''}\n`
    )
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const baseline = coarseExecution(
      { ...inputs, credit: undefined, mode: policy.mode === 'heavy-off' ? 'normal' : policy.mode },
      policy.event
    ).effective
    const selected = execution.effective
    const omitted = requiredCiJobs.filter((job) => !selected.includes(job))
    const status = (job) =>
      baseline.includes(job)
        ? credit
          ? 'Credited from PR'
          : 'Disabled by heavy-off'
        : 'Outside this plan'
    const rows = [
      '| Check | Plan |',
      '| --- | --- |',
      ...selected.map((job) => `| ${job} | Selected |`),
      ...omitted.map((job) => `| ${job} | ${status(job)} |`),
    ].join('\n')
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## CI execution selection\nReason: ${execution.reason}. Selected groups: ${execution.effective.length}.\nSaved mode: ${policy.saved}. Run mode: ${policy.mode}. Proposed mode: ${policy.proposed}.\n\n${deliverySummary}\n\n${rows}\n\n\`\`\`json\n${json}\n\`\`\`\n`
    )
  }
  console.log(json)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
