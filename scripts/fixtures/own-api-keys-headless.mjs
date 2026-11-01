import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { snapshot } from '../stand/snapshot.mjs'

const source = resolve(import.meta.dirname, '../..')
const fixture = await mkdtemp(join(tmpdir(), 'amcore-own-keys-headless-'))
await snapshot(source, fixture)
execFileSync('git', ['init', '--quiet'], { cwd: fixture })
const page = 'apps/web/src/_pages/custom-own-keys'
await mkdir(join(fixture, page, 'ui'), { recursive: true })
await writeFile(
  join(fixture, page, 'ui/custom-own-keys.tsx'),
  await readFile(join(import.meta.dirname, 'own-api-keys-headless-client.tsx.fixture'))
)
await writeFile(
  join(fixture, page, 'index.ts'),
  "export { CustomOwnKeys } from './ui/custom-own-keys'\n"
)
const mount = join(fixture, 'apps/web/src/_app/organization-access/ui/own-api-keys-mount.tsx')
await writeFile(
  mount,
  (await readFile(mount, 'utf8'))
    .replace('@/_pages/own-api-keys', '@/_pages/custom-own-keys')
    .replaceAll('OwnApiKeysPage', 'CustomOwnKeys')
    .replace('query={query}', 'organizationId={query.organizationId}')
)
await writeFile(
  join(fixture, 'apps/web/e2e/real-stack/own-api-keys-headless.spec.ts'),
  await readFile(join(import.meta.dirname, 'own-api-keys-headless.spec.ts.fixture'))
)
console.log(`Prepared independent own-key fixture: ${fixture}`)
console.log(
  `Install: pnpm --dir ${fixture} install --ignore-scripts --no-frozen-lockfile\nRun: pnpm --dir ${fixture} stand e2e --lane real-stack -- own-api-keys-headless.spec.ts\nAfterwards: pnpm --dir ${fixture} stand closeout; then remove only this generated directory.`
)
