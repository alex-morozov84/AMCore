import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { snapshot } from '../stand/snapshot.mjs'
import { prepareProjectInit } from '../lib/project-init-plan.mjs'
import { parseProjectFlags } from '../lib/project-flags.mjs'
import { applyFilesystemTransaction } from '../lib/filesystem-transaction.mjs'

const source = resolve(import.meta.dirname, '../..')
const fixture = await mkdtemp(join(tmpdir(), 'amcore-shop-headless-'))
await snapshot(source, fixture)
execFileSync('git', ['init', '--quiet'], { cwd: fixture })
const projected = process.argv.includes('--projected')
const files = {
  'apps/web/src/_pages/shop-team/ui/shop-team.tsx': (
    await readFile(
      join(import.meta.dirname, 'organization-members-headless-client.tsx.fixture'),
      'utf8'
    )
  )
    .replace('CustomMembers', 'ShopTeam')
    .replace('custom-headless-members', 'shop-team'),
  'apps/web/src/_pages/shop-team/index.ts': "export { ShopTeam } from './ui/shop-team'\n",
  'apps/web/src/_app/organization-access/server/shop-team-mount.tsx': await readFile(
    join(import.meta.dirname, 'organization-shop-headless.server.tsx.fixture'),
    'utf8'
  ),
  [projected
    ? 'apps/web/src/app/shop-team/page.tsx'
    : 'apps/web/src/app/[locale]/shop-team/page.tsx']:
    "import { ShopTeamMount } from '@/_app/organization-access/index.server'\nexport default function Page() { return <ShopTeamMount /> }\n",
  'apps/web/e2e/real-stack/organization-shop-headless.spec.ts': await readFile(
    join(import.meta.dirname, 'organization-shop-headless.spec.ts.fixture'),
    'utf8'
  ),
}
for (const [path, contents] of Object.entries(files)) {
  await mkdir(join(fixture, path, '..'), { recursive: true })
  await writeFile(join(fixture, path), contents)
}
const entry = join(fixture, 'apps/web/src/_app/organization-access/index.server.ts')
const anchor = "export { OrganizationInvitationsMount } from './ui/invitations-mount'"
const entrySource = await readFile(entry, 'utf8')
if (entrySource.split(anchor).length !== 2) throw new Error('Shop fixture entry anchor changed')
await writeFile(
  entry,
  entrySource.replace(anchor, "export { ShopTeamMount } from './server/shop-team-mount'\n" + anchor)
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
console.log(`Prepared fixed-shop headless fixture: ${fixture}`)
console.log(
  `Install dependencies first: pnpm --dir ${fixture} install --ignore-scripts ${process.argv.includes('--projected') ? '--no-frozen-lockfile' : '--frozen-lockfile'}`
)
console.log(
  `Run: pnpm --dir ${fixture} stand e2e --lane real-stack --fixture organization-shop -- organization-shop-headless.spec.ts`
)
