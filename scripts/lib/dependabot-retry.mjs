const delay = 25 * 60 * 60 * 1000
const aggregates = new Set([
  'Test',
  'API E2E',
  'Web E2E',
  'Scaffolding contract (full, real install/build/test)',
])

export function matchesPull(pr, run, repository) {
  const association = run.pull_requests?.find((pull) => pull.number === pr.number)
  return (
    pr.state === 'open' &&
    pr.user?.login === 'dependabot[bot]' &&
    pr.user?.type === 'Bot' &&
    pr.head?.repo?.full_name === repository &&
    pr.base?.repo?.full_name === repository &&
    pr.base.ref === 'main' &&
    run.event === 'pull_request' &&
    run.path === '.github/workflows/ci.yml' &&
    run.head_sha === pr.head.sha &&
    association?.head?.sha === pr.head.sha &&
    association?.base?.sha === pr.base.sha
  )
}

export function eligibleRun(pr, run, repository, now) {
  const age = now - Date.parse(run.created_at)
  return (
    matchesPull(pr, run, repository) &&
    run.status === 'completed' &&
    run.conclusion === 'failure' &&
    run.run_attempt === 1 &&
    Number.isFinite(age) &&
    age >= delay
  )
}

export function installationFailure(jobs) {
  const failed = jobs.filter((job) => job.conclusion === 'failure')
  const failedInstall = (job) =>
    job.steps?.some(
      (step) => step.name === 'Install dependencies' && step.conclusion === 'failure'
    ) &&
    job.steps.every((step) => step.conclusion !== 'failure' || step.name === 'Install dependencies')
  return (
    jobs.every(
      (job) =>
        job.status === 'completed' &&
        ['success', 'failure', 'skipped', 'neutral'].includes(job.conclusion)
    ) &&
    failed.some(failedInstall) &&
    failed.every(
      (job) =>
        failedInstall(job) ||
        (aggregates.has(job.name) &&
          !job.steps?.some((step) => step.name === 'Install dependencies'))
    )
  )
}

// Only trusted-main code calls this module. No PR content, logs or artifacts are loaded.
export async function retryDependabot({ github, context, core, now = Date.now() }) {
  const repo = context.repo
  const repository = `${repo.owner}/${repo.repo}`
  const pulls = await github.paginate(github.rest.pulls.list, {
    ...repo,
    state: 'open',
    base: 'main',
    per_page: 100,
  })
  let count = 0
  for (const pr of pulls) {
    if (pr.user?.login !== 'dependabot[bot]' || pr.head?.repo?.full_name !== repository) continue
    if (await retryPull(github, repo, pr, repository, now)) {
      core.info(`Requested one full CI retry for PR #${pr.number}`)
      count++
    }
  }
  core.info(`Requested ${count} CI retries`)
  return count
}

async function latestRun(github, repo, pr) {
  const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
    ...repo,
    workflow_id: 'ci.yml',
    event: 'pull_request',
    head_sha: pr.head.sha,
    per_page: 100,
  })
  return runs.sort((a, b) => b.id - a.id)[0]
}

async function retryPull(github, repo, listed, repository, now) {
  const parameters = { ...repo, pull_number: listed.number }
  const { data: pr } = await github.rest.pulls.get(parameters)
  const run = await latestRun(github, repo, pr)
  if (!run || !eligibleRun(pr, run, repository, now)) return false
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRunAttempt, {
    ...repo,
    run_id: run.id,
    attempt_number: 1,
    per_page: 100,
  })
  if (!installationFailure(jobs)) return false
  const { data: current } = await github.rest.pulls.get(parameters)
  const latest = await latestRun(github, repo, current)
  if (!latest || latest.id !== run.id || !eligibleRun(current, latest, repository, now))
    return false
  // A full rerun preserves the current-attempt plan and all shard evidence together.
  await github.rest.actions.reRunWorkflow({ ...repo, run_id: run.id })
  return true
}
