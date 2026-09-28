import { run, cleanEnvironment } from './process.mjs'
import { fixtureSql } from './local-sql.mjs'

const m = JSON.parse(
  await run(process.execPath, [`${import.meta.dirname}/active.mjs`], {
    capture: true,
    env: cleanEnvironment({
      AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
      AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
    }),
  })
)
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
  console.log(await fixtureSql(m, query, variables))
} else {
  if (
    args[0] !== 'redis-cli' ||
    !/^[a-f0-9]{64}$/.test(m.redis) ||
    !m.engine?.endpoint?.startsWith('unix://') ||
    args
      .slice(1)
      .some((v) =>
        /^(?:-[hpus]|--(?:host|port|uri|tls|socket|unixsocket|sni|cacert|cert|key|insecure))/.test(
          v
        )
      )
  )
    throw new Error('Foreign Redis transport option')
  console.log(
    await run(
      'docker',
      [
        '--host',
        m.engine.endpoint,
        'exec',
        '-i',
        m.redis,
        'env',
        '-i',
        'PATH=/usr/local/bin:/usr/bin:/bin',
        'redis-cli',
        '-h',
        '127.0.0.1',
        '-p',
        '6379',
        ...args.slice(1),
      ],
      { capture: true }
    )
  )
}
