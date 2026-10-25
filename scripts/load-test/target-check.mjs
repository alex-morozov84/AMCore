// Proves that the effective Compose project is this run's own disposable deployment.
//   node target-check.mjs <config.json> <project> <run> [postgres-inspect.json]
// config.json is `docker compose config --format json` of the run (it holds secrets: this
// tool prints only names and hosts, never values). The optional inspect file is
// `docker inspect` of the running postgres container. Exit 1 lists every violation.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const DB_VOLUME = 'postgres_data_pg18'
const DB_CLIENTS = {
  api: 'DATABASE_URL',
  worker: 'DATABASE_URL',
  migrate: 'DATABASE_URL',
  'load-fixture': 'MIGRATION_DATABASE_URL',
}

function databaseProblem(service, key, value) {
  if (!value) return `${service}: ${key} is empty`
  if (!URL.canParse(value)) return `${service}: ${key} is not a URL`
  const url = new URL(value)
  if (url.hostname !== 'postgres')
    return `${service}: ${key} points at ${url.hostname}, not this project's postgres`
  if (url.searchParams.get('sslmode') !== 'verify-full')
    return `${service}: ${key} lacks sslmode=verify-full`
  return undefined
}

/** @returns {string[]} violations; empty means the target is this run's own project. */
export function checkTarget(config, project, run, postgres) {
  const problems = []
  const services = config?.services ?? {}
  if (config?.name !== project)
    problems.push(`effective project is ${config?.name}, expected ${project}`)
  for (const [service, key] of Object.entries(DB_CLIENTS)) {
    if (!services[service])
      problems.push(`service ${service} is not in the effective configuration`)
    else {
      const problem = databaseProblem(service, key, services[service].environment?.[key])
      if (problem) problems.push(problem)
    }
  }
  const apiUrl = services.web?.environment?.API_URL
  if (apiUrl && URL.canParse(apiUrl) && new URL(apiUrl).hostname !== 'api')
    problems.push(`web: API_URL points at ${new URL(apiUrl).hostname}, not this project's api`)
  const mount = (services.postgres?.volumes ?? []).find(
    (v) => v.type === 'volume' && v.source === DB_VOLUME
  )
  if (!mount) problems.push(`postgres does not mount the ${DB_VOLUME} volume`)
  const volume = config?.volumes?.[DB_VOLUME]
  const volumeName = `${project}_${DB_VOLUME}`
  if (volume?.name !== volumeName)
    problems.push(`database volume is ${volume?.name}, expected ${volumeName}`)
  if (volume?.external) problems.push('database volume must not be external')
  if (volume?.labels?.['org.amcore.load-test'] !== run)
    problems.push('database volume is not labelled with this run id')
  if (postgres) {
    const container = Array.isArray(postgres) ? postgres[0] : postgres
    const labels = container?.Config?.Labels ?? {}
    if (labels['com.docker.compose.project'] !== project)
      problems.push(`running postgres belongs to project ${labels['com.docker.compose.project']}`)
    if (labels['com.docker.compose.service'] !== 'postgres')
      problems.push('inspected container is not the postgres service')
    const data = (container?.Mounts ?? []).find((m) => m.Destination === mount?.target)
    if (data?.Type !== 'volume' || data?.Name !== volumeName)
      problems.push(
        `running postgres stores ${mount?.target} in ${data?.Name ?? 'nothing'}, expected ${volumeName}`
      )
  }
  return problems
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [configFile, project, run, inspectFile] = process.argv.slice(2)
  const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
  const problems = checkTarget(
    read(configFile),
    project,
    run,
    inspectFile ? read(inspectFile) : undefined
  )
  for (const p of problems) console.error(`target-check: ${p}`)
  if (problems.length) process.exit(1)
  console.log(`target-check: ${project} is this run's own deployment`)
}
