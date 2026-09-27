import { readFile } from 'node:fs/promises'
import { run, cleanEnvironment } from './process.mjs'
import { dataAdmission, sql } from './ownership.mjs'
import { docker } from './docker.mjs'

await run(process.execPath, [`${import.meta.dirname}/active.mjs`], {
  capture: true,
  env: cleanEnvironment({
    AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
    AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
  }),
})
const m = JSON.parse(await readFile(process.env.AMCORE_STAND_MANIFEST, 'utf8'))
await dataAdmission(m)
const [service, ...args] = process.argv.slice(2)
if (!['postgres', 'redis'].includes(service))
  throw new Error('Only owned PostgreSQL/Redis fixture commands are supported')
if (service === 'postgres') {
  if (args[0] !== 'psql' || !args.includes('-c')) throw new Error('Unsupported SQL fixture command')
  const query = args[args.indexOf('-c') + 1]
  if (!query || /\\|\b(?:COPY|CONNECT|dblink)\b/i.test(query))
    throw new Error('Unsupported SQL fixture query')
  const encoded = args.includes('--stand-variables')
    ? args[args.indexOf('--stand-variables') + 1]
    : '{}'
  const variables = JSON.parse(encoded)
  if (
    !variables ||
    Array.isArray(variables) ||
    typeof variables !== 'object' ||
    Object.values(variables).some((v) => !['string', 'number'].includes(typeof v))
  )
    throw new Error('Invalid SQL fixture variables')
  console.log(await sql(m, query, false, variables))
} else {
  if (
    args[0] !== 'redis-cli' ||
    args.some((v) =>
      ['-h', '-p', '-u', '--host', '--port', '--uri', '--tls', '--socket'].includes(v)
    )
  )
    throw new Error('Foreign Redis transport option')
  console.log(await docker(m, ['exec', '-i', m.redis, ...args], { capture: true }))
}
