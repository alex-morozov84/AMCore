import { createRequire } from 'node:module'
import { join } from 'node:path'

import { docker, inspect } from './docker.mjs'
import { cleanEnvironment, run } from './process.mjs'
import { dataAdmission, owned } from './ownership.mjs'

/** Execute only admitted fixture commands against a pinned, owned runtime image. */
export async function executeSetupCommand(m, input) {
  let previewDiagnostics = false
  // AMCORE_CONSOLE_ESTABLISHMENT_DIAGNOSTICS_START
  previewDiagnostics =
    m.purpose === 'preview' &&
    m.fixtureProfile === 'organization-establishment' &&
    input.command === 'diagnostics' &&
    Object.keys(input).length === 1
  // AMCORE_CONSOLE_ESTABLISHMENT_DIAGNOSTICS_END
  if (
    !previewDiagnostics &&
    (m.purpose !== 'e2e' ||
      !['organization-setup', 'organization-provisioning', 'product-admin-closed-signup'].includes(
        m.fixtureProfile
      ))
  )
    throw new Error('Wrong setup fixture')
  if (m.fixtureProfile === 'organization-provisioning' && input.command !== 'prepare-account')
    throw new Error('Provisioning fixture allows only prerequisite account preparation')
  await dataAdmission(m)
  const schemas = () => createRequire(join(m.snapshot, 'apps/api/package.json'))('@amcore/shared')
  let args
  if (input.command === 'status' && Object.keys(input).length === 1) args = ['status']
  else if (input.command === 'diagnostics' && Object.keys(input).length === 1) args = []
  else if (input.command === 'prepare-account') {
    const data = schemas().organizationPrepareAccountSchema.parse(input.input)
    args = [
      'prepare-account',
      '--email',
      data.email,
      ...(data.locale ? ['--locale', data.locale] : []),
    ]
  } else if (input.command === 'bootstrap') {
    const data = schemas().organizationBootstrapSchema.parse(input.input)
    args = [
      'bootstrap',
      '--name',
      data.name,
      '--slug',
      data.slug,
      '--admin-user-id',
      data.adminUserId,
    ]
  } else throw new Error('Unsupported setup fixture command')
  const candidates = []
  for (const id of m.resources.container) {
    const container = await inspect(m, 'container', id)
    if (container.Config.Labels['com.docker.compose.service'] !== 'api') continue
    owned(m, container, 'container')
    if (container.Image !== m.images.api) throw new Error('Setup command image changed')
    candidates.push(container.Id)
  }
  if (candidates.length !== 1) throw new Error('Owned API identity unavailable')
  if (input.command === 'diagnostics') {
    // Fixed subprocess probes exercise runner packaging, safe errors and natural resource closure.
    // No caller-supplied environment, command, endpoint or database is accepted.
    const program = `const {spawnSync}=require('node:child_process');
      const run=(args,env)=>{const r=spawnSync(process.execPath,['dist/cli/organization-setup.js',...args],{env,encoding:'utf8',timeout:10000,maxBuffer:16384});
        if(r.error||r.signal)throw new Error('probe failed');return {exit:r.status,output:JSON.parse(r.stdout)}};
      const invalid=run(['prepare-account','--password','<fake-probe-password>'],process.env);
      const unavailable=run(['status'],{...process.env,DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1:1/unavailable'});
      process.stdout.write(JSON.stringify({invalid,unavailable}));`
    return JSON.parse(
      await docker(m, ['exec', '-i', candidates[0], 'node', '-e', program], { capture: true })
    )
  }
  const output = await docker(
    m,
    ['exec', '-i', candidates[0], 'node', 'dist/cli/organization-setup.js', ...args],
    { capture: true }
  )
  if (Buffer.byteLength(output) > 16384) throw new Error('Invalid command output')
  return JSON.parse(output)
}

if (process.argv[1] === import.meta.filename) {
  try {
    const m = JSON.parse(
      await run(process.execPath, [`${import.meta.dirname}/active.mjs`], {
        capture: true,
        env: cleanEnvironment({
          AMCORE_STAND_MANIFEST: process.env.AMCORE_STAND_MANIFEST,
          AMCORE_STAND_TOKEN: process.env.AMCORE_STAND_TOKEN,
        }),
      })
    )
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (input.length > 4096) throw new Error('oversize')
    }
    process.stdout.write(JSON.stringify(await executeSetupCommand(m, JSON.parse(input))))
  } catch {
    process.stderr.write('Owned setup command failed\n')
    process.exitCode = 1
  }
}
