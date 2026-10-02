import { run, cleanEnvironment } from './process.mjs'
import { docker, inspect } from './docker.mjs'
import { fixtureSql } from './local-sql.mjs'

// Test-only extension: authenticated e2e lease, exact owned containers, no arbitrary target/command.
const m = JSON.parse(
  await run(process.execPath, [`${import.meta.dirname}/active.mjs`], {
    capture: true,
    env: cleanEnvironment({
      AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
      AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
    }),
  })
)
if (m.purpose !== 'e2e' || !/^[a-f0-9-]{36}$/.test(m.attempt))
  throw new Error('Invalid proof stand')
const prefix = `/tmp/amcore-settings-proof-${m.attempt}`
const containers = {}
for (const id of m.resources.container) {
  const c = await inspect(m, 'container', id)
  const labels = c.Config.Labels
  if (labels['org.amcore.stand'] !== m.uuid || labels['org.amcore.attempt'] !== m.attempt)
    throw new Error('Foreign proof container')
  const service = labels['com.docker.compose.service']
  if (['api', 'worker'].includes(service)) {
    if (c.Image !== m.images[service] || !c.State.Running) throw new Error('Changed proof process')
    containers[service] = id
  }
}
if (!containers.api || !containers.worker) throw new Error('Proof requires owned API and worker')
const execNode = (script) =>
  docker(m, ['exec', containers.api, 'node', '-e', script], { capture: true })
const action = process.argv[2]
if (action === 'start') {
  const script = `const fs=require('fs'); const p=${JSON.stringify(prefix)};
    fs.writeFileSync(p+'.pid',String(process.pid),{flag:'wx'});
    setTimeout(()=>process.kill(process.pid,'SIGTERM'),300000).unref();require('./dist/main.js');`
  await docker(m, [
    'exec',
    '-d',
    '--env',
    'API_PORT=5003',
    containers.api,
    'sh',
    '-c',
    'exec node -e "$1" > "$2" 2>&1',
    'amcore-settings-proof',
    script,
    prefix + '.log',
  ])
  console.log('Owned API2 process started; fixed internal port 5003, five-minute deadline')
} else if (action === 'stop') {
  await execNode(`const fs=require('fs');const p=${JSON.stringify(prefix)};
    if(fs.existsSync(p+'.pid')){const pid=Number(fs.readFileSync(p+'.pid','utf8'));
      if(!Number.isInteger(pid)||pid<2)throw Error('Invalid proof pid');
      if(fs.existsSync('/proc/'+pid+'/cmdline')){
        if(!fs.readFileSync('/proc/'+pid+'/cmdline','utf8').includes(p))throw Error('Foreign proof pid');
        process.kill(pid,'SIGTERM');}fs.unlinkSync(p+'.pid');}`)
} else if (action === 'observations') {
  const logs = await Promise.all([
    docker(m, ['logs', containers.api], { capture: true }),
    execNode(
      `const fs=require('fs');const p=${JSON.stringify(prefix)};if(fs.existsSync(p+'.log'))process.stdout.write(fs.readFileSync(p+'.log'))`
    ),
    docker(m, ['logs', containers.worker], { capture: true }),
  ])
  const observations = logs.map((log, i) => {
    const events = []
    for (const raw of log.split('\n')) {
      // Strip terminal formatting before reading the bounded structured event.
      // eslint-disable-next-line no-control-regex
      const line = raw.replace(/\x1b\[[0-9;]*m/g, '')
      const start = line.indexOf('{'),
        end = line.lastIndexOf('}')
      if (start < 0) continue
      try {
        const event = JSON.parse(line.slice(start, end + 1))
        if (
          [
            'runtime_setting_applied',
            'runtime_setting_refresh_failed',
            'runtime_setting_refresh_recovered',
          ].includes(event.event)
        )
          events.push(
            Object.fromEntries(
              ['event', 'key', 'revision', 'intervalSeconds', 'processRole', 'instanceId']
                .filter((k) => k in event)
                .map((k) => [k, event[k]])
            )
          )
      } catch {
        /* unrelated log line */
      }
    }
    return { process: ['api1', 'api2', 'worker'][i], events }
  })
  console.log(JSON.stringify(observations))
} else if (action === 'restart-worker') {
  await docker(m, ['restart', containers.worker])
  console.log('Owned worker restarted')
} else if (action === 'block-reads') {
  await fixtureSql(
    m,
    'LOCK TABLE core.platform_settings IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(38);'
  )
  console.log('Owned settings SELECT lock released')
} else if (action === 'pause-redis') {
  await docker(m, [
    'exec',
    m.redis,
    'redis-cli',
    '-h',
    '127.0.0.1',
    '-p',
    '6379',
    'CLIENT',
    'PAUSE',
    '40000',
    'ALL',
  ])
} else throw new Error('Unknown settings proof action')
