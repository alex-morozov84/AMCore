import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { snapshot } from '../stand/snapshot.mjs'
import { prepareProjectInit } from '../lib/project-init-plan.mjs'
import { parseProjectFlags } from '../lib/project-flags.mjs'
import { applyFilesystemTransaction } from '../lib/filesystem-transaction.mjs'

const source = resolve(import.meta.dirname, '../..')
const fixture = await mkdtemp(join(tmpdir(), 'amcore-invitation-headless-'))
await snapshot(source, fixture)
// Stand snapshots need a Git source inventory; this temporary repository has no commits.
execFileSync('git', ['init', '--quiet'], { cwd: fixture })
const client = 'apps/web/src/_pages/custom-invitations/ui/custom-invitations.tsx'
await mkdir(join(fixture, 'apps/web/src/_pages/custom-invitations/ui'), { recursive: true })
await writeFile(
  join(fixture, client),
  await readFile(join(import.meta.dirname, 'organization-invitations-headless-client.tsx.fixture'))
)
await writeFile(
  join(fixture, 'apps/web/src/_pages/custom-invitations/index.ts'),
  "export { CustomInvitations } from './ui/custom-invitations'\n"
)
const mount = join(fixture, 'apps/web/src/_app/organization-access/ui/invitations-mount.tsx')
await writeFile(
  mount,
  (await readFile(mount, 'utf8'))
    .replace('@/_pages/organization-invitations', '@/_pages/custom-invitations')
    .replaceAll('OrganizationInvitationsClient', 'CustomInvitations')
)
const test = await readFile(
  join(import.meta.dirname, 'organization-invitations-headless.spec.ts.fixture'),
  'utf8'
)
await writeFile(
  join(fixture, 'apps/web/e2e/real-stack/organization-invitations-headless.spec.ts'),
  test
)
if (process.argv.includes('--projected')) {
  const plan = prepareProjectInit(
    fixture,
    parseProjectFlags([
      '--mode=single',
      '--locale=ru',
      '--admin-console=disabled',
      '--storybook=disabled',
      '--route-progress=disabled',
    ]),
    'panel'
  )
  applyFilesystemTransaction({ root: fixture, operations: plan.operationPlan.operationsForApply() })
  plan.assertApplied()
}
console.log(`Prepared custom-headless fixture: ${fixture}`)
console.log(
  `Install projected dependencies first: pnpm --dir ${fixture} install --ignore-scripts --no-frozen-lockfile\nRun: pnpm --dir ${fixture} stand e2e --lane real-stack -- organization-invitations-headless.spec.ts`
)
