// Run from a separate, trusted AMCore checkout. Fetch the PR as Git objects only.
import { execFileSync } from 'node:child_process'
import { verifyForkInitialization } from './lib/ci-fork-initialization.mjs'

try {
  const [repository, number, ...extra] = process.argv.slice(2)
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') ||
    !/^[1-9]\d*$/.test(number ?? '') ||
    extra.length
  )
    throw new Error('Usage: node scripts/verify-first-product-pr.mjs OWNER/FORK PR_NUMBER')
  const api = (_env, repo) => async (path) =>
    JSON.parse(
      execFileSync(
        'gh',
        ['api', '--hostname', 'github.com', `repos/${repo}${path ? `/${path}` : ''}`],
        { encoding: 'utf8' }
      )
    )
  const read = api({}, repository)
  const pr = await read(`pulls/${number}`)
  if (pr.state !== 'open' || pr.draft !== false)
    throw new Error('Expected an open PR ready for review')
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
  git('fetch', '--no-tags', `https://github.com/${repository}.git`, `refs/pull/${number}/merge`)
  const checkout = git('rev-parse', 'FETCH_HEAD').trim()
  await verifyForkInitialization(
    process.cwd(),
    repository,
    { pull_request: pr },
    {
      GITHUB_REPOSITORY_ID: String(pr.base.repo.id),
      GITHUB_SHA: checkout,
    },
    api
  )
  console.log(
    `Verified fork initialization: ${repository}#${number} base=${pr.base.sha} head=${pr.head.sha}`
  )
} catch (error) {
  console.error(`Fork initialization not verified: ${error.message}`)
  process.exitCode = 1
}
