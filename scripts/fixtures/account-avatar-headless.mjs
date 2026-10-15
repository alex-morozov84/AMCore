import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { snapshot } from '../stand/snapshot.mjs'
import { prepareProjectInit } from '../lib/project-init-plan.mjs'
import { parseProjectFlags } from '../lib/project-flags.mjs'
import { applyFilesystemTransaction } from '../lib/filesystem-transaction.mjs'

const source = resolve(import.meta.dirname, '../..')
const fixture = await mkdtemp(join(tmpdir(), 'amcore-account-headless-'))
await snapshot(source, fixture)
// Stand snapshots need a Git source inventory; this temporary repository has no commits.
execFileSync('git', ['init', '--quiet'], { cwd: fixture })
await mkdir(join(fixture, 'apps/web/src/_pages/custom-account/ui'), { recursive: true })
await writeFile(
  join(fixture, 'apps/web/src/_pages/custom-account/ui/custom-account.tsx'),
  await readFile(join(import.meta.dirname, 'account-avatar-headless-client.tsx.fixture'))
)
await writeFile(
  join(fixture, 'apps/web/src/_pages/custom-account/index.ts'),
  "export { CustomAccount } from './ui/custom-account'\n"
)
// The application places the account block: swap it for the custom one in the single placement.
const layout = join(fixture, 'apps/web/src/app/[locale]/(dashboard)/layout.tsx')
const original = await readFile(layout, 'utf8')
const swapped = original
  .replace(
    "import { AccountMenu } from '@/widgets/account-menu'",
    "import { CustomAccount } from '@/_pages/custom-account'"
  )
  .replace('<AccountMenu />', '<CustomAccount />')
if (swapped === original)
  throw new Error('The dashboard layout no longer places AccountMenu as expected')
await writeFile(layout, swapped)
await writeFile(
  join(fixture, 'apps/web/e2e/real-stack/account-avatar-headless.spec.ts'),
  await readFile(join(import.meta.dirname, 'account-avatar-headless.spec.ts.fixture'), 'utf8')
)
if (process.argv.includes('--projected')) {
  const plan = prepareProjectInit(
    fixture,
    parseProjectFlags([
      '--mode=single',
      '--locale=ru',
      '--admin-console=disabled',
      '--storybook=disabled',
    ]),
    'panel'
  )
  applyFilesystemTransaction({ root: fixture, operations: plan.operationPlan.operationsForApply() })
  plan.assertApplied()
}
console.log(`Prepared custom-headless account fixture: ${fixture}`)
console.log(
  `Install projected dependencies first: pnpm --dir ${fixture} install --ignore-scripts --no-frozen-lockfile\nRun: pnpm --dir ${fixture} stand e2e --lane real-stack -- account-avatar-headless.spec.ts`
)
