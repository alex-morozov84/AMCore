import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { prepareAccountMfaPreview } from './account-mfa-source.mjs'

test('MFA UI simulation replaces only an owned preview copy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mfa-preview-'))
  const worktree = join(root, 'worktree')
  const snapshot = join(root, 'snapshot')
  const target = 'apps/web/src/_app/account-security/ui'
  try {
    for (const base of [worktree, snapshot]) {
      await mkdir(join(base, target), { recursive: true })
      await writeFile(join(base, target, 'client.tsx'), 'real adapter')
    }
    await mkdir(join(snapshot, 'docker/testing/account-mfa'), { recursive: true })
    for (const file of ['preview-client.tsx', 'preview-adapter.ts'])
      await writeFile(join(snapshot, 'docker/testing/account-mfa', file), file)
    const m = {
      worktree,
      snapshot,
      fixtureProfile: 'account-mfa-ui',
      purpose: 'preview',
      mocked: false,
    }
    await prepareAccountMfaPreview(m)
    assert.equal(await readFile(join(worktree, target, 'client.tsx'), 'utf8'), 'real adapter')
    assert.equal(await readFile(join(snapshot, target, 'client.tsx'), 'utf8'), 'preview-client.tsx')
    await assert.rejects(prepareAccountMfaPreview({ ...m, snapshot: worktree }), /own managed/)
    await assert.rejects(prepareAccountMfaPreview({ ...m, purpose: 'e2e' }), /own managed/)
    await assert.rejects(prepareAccountMfaPreview({ ...m, mocked: true }), /own managed/)
    assert.equal(await readFile(join(worktree, target, 'client.tsx'), 'utf8'), 'real adapter')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
