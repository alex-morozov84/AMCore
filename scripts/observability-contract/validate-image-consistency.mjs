// AMCore observability contract — the Prometheus/Alertmanager image digests
// pinned in docker-compose.yml and in .github/workflows/ci.yml's `promtool`
// job env vars must always match; a future bump to one and not the other
// would silently test a different Prometheus/Alertmanager than production
// actually runs.
import { readFileSync } from 'node:fs'

/** @returns {{ service: string, expected: string }[]} */
function readComposeImages(composeText, services) {
  return services.map((service) => {
    const serviceBlock = new RegExp(`^  ${service}:\\n(?:.*\\n)*?    image: (\\S+)`, 'm')
    const match = serviceBlock.exec(composeText)
    if (!match) throw new Error(`docker-compose.yml: no "image:" found for service "${service}"`)
    return { service, expected: match[1] }
  })
}

/** @returns {{ envVar: string, actual: string }[]} */
function readCiEnvImages(ciText, envVars) {
  return envVars.map((envVar) => {
    const match = new RegExp(`^\\s*${envVar}:\\s*(\\S+)\\s*$`, 'm').exec(ciText)
    if (!match) throw new Error(`ci.yml: no "${envVar}:" env var found`)
    return { envVar, actual: match[1] }
  })
}

const PAIRS = [
  { service: 'prometheus', envVar: 'PROMETHEUS_IMAGE' },
  { service: 'alertmanager', envVar: 'ALERTMANAGER_IMAGE' },
]

export function validateImageConsistency(composeText, ciText) {
  const compose = readComposeImages(
    composeText,
    PAIRS.map((p) => p.service)
  )
  const ci = readCiEnvImages(
    ciText,
    PAIRS.map((p) => p.envVar)
  )
  const violations = []
  for (const pair of PAIRS) {
    const composeImage = compose.find((c) => c.service === pair.service).expected
    const ciImage = ci.find((c) => c.envVar === pair.envVar).actual
    if (composeImage !== ciImage) {
      violations.push(
        `docker-compose.yml's "${pair.service}" image (${composeImage}) does not match ` +
          `ci.yml's ${pair.envVar} (${ciImage})`
      )
    }
  }
  return violations
}

export function runAgainstRealRepo({
  composePath = 'docker-compose.yml',
  ciPath = '.github/workflows/ci.yml',
} = {}) {
  return validateImageConsistency(readFileSync(composePath, 'utf8'), readFileSync(ciPath, 'utf8'))
}
