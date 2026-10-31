import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { compiledFingerprint, toolingFingerprint } from '../lighthouse/reuse.mjs'

test('reuse preserves exact application and lock inputs while binding a separate tooling revision', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'amcore-audit-reuse-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'apps/web/src'), { recursive: true })
  await mkdir(join(root, 'scripts'), { recursive: true })
  await writeFile(join(root, 'apps/web/src/page.tsx'), 'export default function Page() {}')
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9')
  await writeFile(join(root, 'scripts/audit.mjs'), 'export const version=1')
  const compiled = await compiledFingerprint(root),
    tooling = await toolingFingerprint(root)
  await writeFile(join(root, 'scripts/audit.mjs'), 'export const version=2')
  assert.equal(await compiledFingerprint(root), compiled)
  assert.notEqual(await toolingFingerprint(root), tooling)
  await writeFile(join(root, 'apps/web/src/page.tsx'), 'export default function ChangedPage() {}')
  assert.notEqual(await compiledFingerprint(root), compiled)
  await mkdir(join(root, 'docker/caddy'), { recursive: true })
  const beforeEdge = await compiledFingerprint(root)
  await writeFile(join(root, 'docker/caddy/Caddyfile.product-admin-stand'), 'owned generated edge')
  assert.notEqual(await compiledFingerprint(root), beforeEdge)
  assert.equal(
    await compiledFingerprint(root, ['docker/caddy/Caddyfile.product-admin-stand']),
    beforeEdge
  )
  const changedApp = await compiledFingerprint(root)
  await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 10')
  assert.notEqual(await compiledFingerprint(root), changedApp)
})
