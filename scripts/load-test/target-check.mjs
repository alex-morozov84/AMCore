// Proves that the effective Compose project is this run's own disposable deployment.
//   node target-check.mjs <config.json> <project> <run> [running-inspect.json]
// config.json is `docker compose config --format json` of the run (it holds secrets: this
// tool prints only names and hosts, never values). The optional inspect file is the
// `docker inspect` of the running postgres, api, worker and web. Exit 1 lists violations.
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
export function checkTarget(config, project, run, running) {
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
  if (running) problems.push(...runningProblems(config, project, running, mount, volumeName))
  return problems
}

const envOf = (container, key) =>
  (container?.Config?.Env ?? []).find((e) => e.startsWith(`${key}=`))?.slice(key.length + 1)
const networksOf = (container) => Object.keys(container?.NetworkSettings?.Networks ?? {})

// The running containers must be the ones the rendered configuration describes: a
// container created from an older .env (for example with an external database URL) keeps
// that URL until it is recreated, and the loader writes through the running API.
function runningProblems(config, project, running, mount, volumeName) {
  const problems = []
  const byService = {}
  for (const c of Array.isArray(running) ? running : [running]) {
    const labels = c?.Config?.Labels ?? {}
    const service = labels['com.docker.compose.service']
    if (labels['com.docker.compose.project'] !== project)
      problems.push(
        `running ${service ?? 'container'} belongs to project ${labels['com.docker.compose.project']}`
      )
    else if (service) byService[service] = c
  }
  const postgres = byService.postgres
  if (!postgres) return [...problems, 'no running postgres container in this project']
  const data = (postgres.Mounts ?? []).find((m) => m.Destination === mount?.target)
  if (data?.Type !== 'volume' || data?.Name !== volumeName)
    problems.push(
      `running postgres stores ${mount?.target} in ${data?.Name ?? 'nothing'}, expected ${volumeName}`
    )
  const expected = { api: 'DATABASE_URL', worker: 'DATABASE_URL', web: 'API_URL' }
  for (const [service, key] of Object.entries(expected)) {
    const c = byService[service]
    if (!c) {
      problems.push(`no running ${service} container in this project`)
      continue
    }
    // Compared, never printed: the URLs hold passwords.
    if (envOf(c, key) !== config.services?.[service]?.environment?.[key])
      problems.push(`running ${service} uses another ${key} than the configuration; recreate it`)
    const peer = service === 'web' ? byService.api : postgres
    if (peer && !networksOf(c).some((n) => networksOf(peer).includes(n)))
      problems.push(
        `running ${service} shares no network with this project's ${service === 'web' ? 'api' : 'postgres'}`
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
