// AMCore observability contract — live scrape-target health (item 4, part 1).
import { getJson, PROMETHEUS_URL } from './http.mjs'

const EXPECTED_JOBS = ['amcore-api', 'amcore-worker']

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
    const target = active.find((t) => t.labels?.job === job)
    if (!target) {
      violations.push(`no active target for job "${job}"`)
      continue
    }
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
  return violations
}
