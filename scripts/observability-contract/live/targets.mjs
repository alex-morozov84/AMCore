// AMCore observability contract — live scrape-target health (item 4, part 1).
import { getJson, PROMETHEUS_URL } from './http.mjs'

const EXPECTED_JOBS = ['amcore-api', 'amcore-worker']
// Prometheus's own self-scrape job is a legitimate, expected extra target —
// shipped in docker/monitoring/prometheus/prometheus.yml's own `prometheus`
// scrape_config. Any OTHER job name is unexpected and must fail (R3).
const ALLOWED_EXTRA_JOBS = new Set(['prometheus'])

export async function areTargetsUp() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/targets`)
  const active = body?.data?.activeTargets ?? []
  return EXPECTED_JOBS.every((job) =>
    active.some((t) => t.labels?.job === job && t.health === 'up')
  )
}

/** @returns {string[]} violations against the exact expected target set. */
export async function checkTargets() {
  const { body } = await getJson(`${PROMETHEUS_URL}/api/v1/targets`)
  const active = body?.data?.activeTargets ?? []
  const violations = []

  for (const job of EXPECTED_JOBS) {
    const matches = active.filter((t) => t.labels?.job === job)
    if (matches.length === 0) {
      violations.push(`no active target for job "${job}"`)
      continue
    }
    if (matches.length > 1) {
      violations.push(`job "${job}": expected exactly 1 active target, found ${matches.length}`)
    }
    const target = matches[0]
    if (!target.scrapeUrl?.endsWith('/api/v1/metrics')) {
      violations.push(
        `job "${job}": scrapeUrl "${target.scrapeUrl}" does not end with /api/v1/metrics`
      )
    }
    if (target.health !== 'up') {
      violations.push(`job "${job}": health is "${target.health}", expected "up"`)
    }
    if (target.lastError) {
      violations.push(`job "${job}": lastError is "${target.lastError}", expected empty`)
    }
  }

  for (const target of active) {
    const job = target.labels?.job
    if (!EXPECTED_JOBS.includes(job) && !ALLOWED_EXTRA_JOBS.has(job)) {
      violations.push(
        `unexpected active target for job "${job}" (instance "${target.labels?.instance}")`
      )
    }
  }
  return violations
}
