// Dependabot health for the freshness report. The root version-update job has a fixed
// 55 minute limit (GitHub documents it as not extendable). A job that hits it is
// cancelled and opens no pull request, so the only trace is a cancelled run.
const ROOT_JOB = /^npm_and_yarn in \/\. - Update/
const LIMIT_MINUTES = 55
const WINDOW_DAYS = 14
// A job prepares one update per outdated package, about 40 s each in this workspace,
// so roughly 80 packages fill the limit. Warn well before that.
export const BACKLOG_WARN = 40

const major = (version) => Number.parseInt(String(version).replace(/^\D+/, '').split('.')[0], 10)

/** Packages that are behind inside their current major: what Dependabot has to prepare. */
export function backlogCount(outdated) {
  return Object.values(outdated).filter(
    (v) => v?.current && v?.latest && major(v.latest) === major(v.current) && v.current !== v.latest
  ).length
}

const minutes = (run) => (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 60000

/** Summarise the recent root-job runs; `runs` is the `gh run list --json` shape. */
export function rootJobHealth(runs, now = Date.now()) {
  const recent = runs
    .filter((run) => ROOT_JOB.test(run.name) && run.status === 'completed')
    .filter((run) => now - Date.parse(run.createdAt) <= WINDOW_DAYS * 86400000)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  if (!recent.length) return { state: 'unknown' }
  const lastSuccess = recent.find((run) => run.conclusion === 'success')
  if (recent[0].conclusion === 'success') return { state: 'ok', lastSuccess }
  return {
    state: 'failing',
    lastSuccess,
    conclusions: recent.slice(0, 5).map((run) => run.conclusion),
    hitLimit: recent.some(
      (run) => run.conclusion === 'cancelled' && minutes(run) >= LIMIT_MINUTES - 5
    ),
  }
}

function renderJob(runs) {
  if (runs.error) return [`> ⚠️ ${runs.error}`, '']
  const health = rootJobHealth(runs.rows)
  if (health.state === 'unknown')
    return [`❔ No finished root update job in the last ${WINDOW_DAYS} days.`, '']
  if (health.state === 'ok')
    return ['✅ The latest root update job (`npm_and_yarn in /`) finished.', '']
  const since = health.lastSuccess ? `last success ${health.lastSuccess.createdAt}` : 'no success'
  return [
    `⚠️ The latest root update job did not finish (${health.conclusions.join(', ')}; ${since}).`,
    health.hitLimit
      ? 'A job that runs for about 55 minutes is killed by the fixed GitHub limit and opens no pull request. Update packages by hand to shrink the backlog.'
      : 'Open the Dependabot tab (Insights → Dependency graph) to see why.',
    '',
  ]
}

function renderBacklog(backlog) {
  if (backlog.error) return [`> ⚠️ ${backlog.error}`, '']
  const behind = `${backlog.count} packages are behind inside their current major`
  return backlog.count >= BACKLOG_WARN
    ? [`⚠️ ${behind} (warning from ${BACKLOG_WARN}). Dependabot's job may run out of time.`, '']
    : [`✅ ${behind}.`, '']
}

export function renderDependabotHealth({ runs, backlog }) {
  return ['## Dependabot health', '', ...renderJob(runs), ...renderBacklog(backlog)]
}
