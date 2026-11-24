import { execFileSync } from 'node:child_process'
import { coarseExecution, validateExecutionPlan } from './ci-required.mjs'

const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const id = (value) => /^[1-9]\d*$/.test(String(value))
const artifactName = (attempt) => `ci-pr-proof-${attempt}`
const git = (root, ...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

export function prProof(root, event, plan, repositoryId) {
  return {
    version: 1,
    repositoryId: String(repositoryId),
    pull: event.number,
    tree: git(root, 'rev-parse', `${plan.source.checkout}^{tree}`),
    plan,
  }
}

function proofInputsChanged(paths) {
  return paths.some((path) =>
    /^(?:\.github\/|scripts\/|ci\/|PROJECT_CONTEXT\.md$|pnpm-[^/]+\.ya?ml$|turbo\.json$)|(?:^|\/)(?:package\.json|(?:playwright|jest|vitest)\.[^/]+|\.env[^/]*)$/.test(
      path
    )
  )
}

// A GitHub run and its artifact provide one result for the entire admitted PR plan.
function admitProof(root, context, pr, run, proof, checkout) {
  const { source, policy, repositoryId } = context
  const plan = proof?.plan
  if (
    proof?.version !== 1 ||
    proof.repositoryId !== repositoryId ||
    proof.pull !== pr.number ||
    !plan ||
    plan.event !== 'pull_request' ||
    plan.source?.base !== source.base ||
    plan.source?.head !== pr.head.sha ||
    !sha(plan.source?.checkout) ||
    plan.run !== String(run.id) ||
    plan.attempt !== String(run.run_attempt) ||
    plan.inputs?.mode !== policy.mode ||
    proof.tree !== git(root, 'rev-parse', `${source.checkout}^{tree}`)
  )
    throw new Error('PR evidence does not match this delivery')
  if (
    checkout?.sha !== plan.source.checkout ||
    checkout.tree?.sha !== proof.tree ||
    checkout.parents?.map((parent) => parent.sha).join(' ') !== `${source.base} ${pr.head.sha}`
  )
    throw new Error('Verified checkout or diff does not match delivery')
  const { integration } = context
  const identity = { source: plan.source, diffComplete: true, integration }
  validateExecutionPlan(plan, {
    ...identity,
    ...{ repository: policy.repository, event: 'pull_request' },
    run: String(run.id),
    attempt: String(run.run_attempt),
    role: policy.role,
    mode: policy.mode,
  })
  const baseline = coarseExecution(
    { ...context.classification, integration, role: policy.role, mode: policy.mode },
    'push'
  )
  if (baseline.effective.some((job) => !plan.effective.includes(job)))
    throw new Error('PR did not cover the applicable push plan')
  return { pull: pr.number, run: String(run.id), attempt: String(run.run_attempt) }
}

function matchingPull(pr, context, parents) {
  const { source, repositoryId } = context
  return (
    id(pr.number) &&
    pr.merged_at &&
    pr.merge_commit_sha === source.checkout &&
    pr.base?.ref === 'main' &&
    String(pr.base?.repo?.id) === repositoryId &&
    sha(pr.head?.sha) &&
    (parents.length === 1 || parents[1] === pr.head.sha)
  )
}

function matchingRun(run, context, pr) {
  return (
    id(run.id) &&
    id(run.run_attempt) &&
    run.head_sha === pr.head.sha &&
    run.event === 'pull_request' &&
    run.status === 'completed' &&
    run.conclusion === 'success' &&
    run.path === '.github/workflows/ci.yml' &&
    String(run.repository?.id) === context.repositoryId &&
    Array.isArray(run.pull_requests) &&
    (run.pull_requests.length === 0 ||
      run.pull_requests.some((pull) => pull.number === pr.number)) &&
    Date.parse(run.updated_at) <= Date.parse(pr.merged_at)
  )
}

async function prIntegration(root, base, head, api) {
  try {
    return Boolean(git(root, 'rev-list', '--merges', `${base}..${head}`))
  } catch {
    const comparison = await api(`compare/${base}...${head}?per_page=100`)
    if (
      !Array.isArray(comparison.commits) ||
      comparison.total_commits !== comparison.commits.length ||
      comparison.commits.some(
        (commit) =>
          !sha(commit.sha) ||
          !Array.isArray(commit.parents) ||
          commit.parents.some((parent) => !sha(parent.sha))
      )
    )
      throw new Error('Incomplete PR history')
    return comparison.commits.some((commit) => commit.parents.length > 1)
  }
}

export async function resolveDeliveryProof(root, context, api) {
  const { source, policy, changedFiles, repositoryId, payload } = context
  if (
    policy.event !== 'push' ||
    payload.ref !== 'refs/heads/main' ||
    payload.forced !== false ||
    payload.before !== source.base ||
    payload.after !== source.checkout ||
    !context.classification?.diffComplete ||
    policy.fullOnce ||
    !id(repositoryId) ||
    !['normal', 'full'].includes(policy.mode) ||
    proofInputsChanged(changedFiles)
  )
    return { reason: 'event, history or CI inputs are ineligible' }

  try {
    const parents = git(root, 'show', '-s', '--format=%P', source.checkout).split(' ')
    if (parents[0] !== source.base || parents.length > 2)
      throw new Error('Push is not one supported delivery')
    const pulls = (await api(`commits/${source.checkout}/pulls`)).filter((pr) =>
      matchingPull(pr, context, parents)
    )
    if (pulls.length !== 1) throw new Error('No unique merged PR for this commit')
    const [pr] = pulls
    if (parents.length === 1 && (await api('')).allow_rebase_merge !== false)
      return { reason: 'one-parent delivery is ambiguous while rebase merge is available' }
    const integration = await prIntegration(root, source.base, pr.head.sha, api)
    const { workflow_runs: runs } = await api(
      `actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=20`
    )
    for (const run of runs.filter((entry) => matchingRun(entry, context, pr))) {
      try {
        const { jobs } = await api(
          `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`
        )
        const gates = jobs.filter((job) => job.name === 'CI required')
        if (
          gates.length !== 1 ||
          gates[0].conclusion !== 'success' ||
          !(Date.parse(gates[0].completed_at) <= Date.parse(pr.merged_at))
        )
          throw new Error('CI required did not pass')
        const { artifacts } = await api(
          `actions/runs/${run.id}/artifacts?name=${artifactName(run.run_attempt)}`
        )
        const proofs = artifacts.filter(
          (artifact) =>
            artifact.name === artifactName(run.run_attempt) && !artifact.expired && id(artifact.id)
        )
        if (proofs.length !== 1) throw new Error('No unique PR artifact')
        const proof = await api(`actions/artifacts/${proofs[0].id}/zip`, true)
        const checkoutSha = proof?.plan?.source?.checkout
        if (!sha(checkoutSha)) throw new Error('Invalid verified checkout')
        const checkout = await api(`git/commits/${checkoutSha}`)
        return {
          credit: admitProof(root, { ...context, integration }, pr, run, proof, checkout),
        }
      } catch {
        // A different successful run may have checked the actual delivery.
      }
    }
    return { reason: 'no successful PR attempt matched the delivery and its plan' }
  } catch {
    return { reason: 'merged PR or Actions evidence is unavailable' }
  }
}
