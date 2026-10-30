import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  MFA_DEPLOYMENT_CONTRACT,
  MFA_PROTOCOL_VERSION,
} from '../packages/shared/dist/lib/mfa-deployment.js'

const root = path.resolve(import.meta.dirname, '..')
const component = process.argv[2]
if (!['api-worker', 'web'].includes(component)) throw new Error('Expected api-worker or web')
const sourceCommit = process.env.BUILD_SOURCE_COMMIT || null
if (sourceCommit !== null && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sourceCommit))
  throw new Error('MFA deployment artifact requires BUILD_SOURCE_COMMIT')
let buildId, output
if (component === 'api-worker') {
  const dist = path.join(root, 'apps/api/dist')
  for (const file of [
    'cli/mfa-maintenance.js',
    'cli/mfa-recovery.js',
    'cli/mfa-deployment.js',
    'core/auth/mfa-enrollment.controller.js',
    'core/auth/mfa-publication.controller.js',
  ])
    if (!(await stat(path.join(dist, file))).isFile())
      throw new Error('Incomplete API MFA artifact')
  buildId = JSON.parse(await readFile(path.join(dist, 'build-identity.json'), 'utf8')).id
  output = path.join(dist, 'mfa-artifact.json')
} else {
  const next = path.join(root, 'apps/web/.next')
  for (const file of [
    'server/app/api/auth/mfa/route.js',
    'server/app/api/auth/browser-context/route.js',
  ])
    if (!(await stat(path.join(next, file))).isFile())
      throw new Error('Incomplete web MFA artifact')
  buildId = createHash('sha256')
    .update(await readFile(path.join(next, 'BUILD_ID')))
    .update(await readFile(path.join(next, 'server/app-paths-manifest.json')))
    .digest('hex')
  output = path.join(next, 'standalone/apps/web/mfa-artifact.json')
}
if (!/^[a-f0-9]{64}$/.test(buildId ?? '')) throw new Error('Invalid MFA build identity')
await writeFile(
  output,
  JSON.stringify({
    schemaVersion: 1,
    contract: MFA_DEPLOYMENT_CONTRACT,
    protocol: MFA_PROTOCOL_VERSION,
    component,
    buildId,
    sourceCommit,
    recoveryCommand: component === 'api-worker',
  }) + '\n'
)
