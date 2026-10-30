import { readdir, readFile, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { admitSource } from '../stand/snapshot.mjs'
import { load, save, directory } from '../stand/state.mjs'
import { assertNoSurvivors } from '../stand/survivors.mjs'
import { invariant } from '../lib/lighthouse-plan.mjs'

async function files(root, prefix = '') {
  const output = []
  for (const item of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${item.name}` : item.name
    if (!admitSource(name)) continue
    invariant(!item.isSymbolicLink(), 'reuse-source-symlink-refused')
    if (item.isDirectory()) output.push(...(await files(root, name)))
    else if (item.isFile()) output.push(name)
  }
  return output.sort()
}
export async function compiledFingerprint(root, omitted = []) {
  const names = (await files(root)).filter(
    (name) =>
      !omitted.includes(name) &&
      (/^(apps|packages|docker|patches)\//.test(name) ||
        [
          'package.json',
          'pnpm-lock.yaml',
          'pnpm-workspace.yaml',
          '.dockerignore',
          'PROJECT_CONTEXT.md',
        ].includes(name))
  )
  const hash = createHash('sha256')
  for (const name of names)
    hash
      .update(name)
      .update('\0')
      .update(await readFile(join(root, name)))
      .update('\0')
  return hash.digest('hex')
}
export async function toolingFingerprint(root) {
  const hash = createHash('sha256')
  for (const name of await files(root, 'scripts'))
    hash
      .update(name)
      .update('\0')
      .update(await readFile(join(root, name)))
      .update('\0')
  return hash.digest('hex')
}

// Caller holds this stopped stand's lease. Never accepts an arbitrary source or image.
export async function refreshAuditTools(id, root) {
  const m = await load(id)
  invariant(
    m.worktree === root &&
      m.state === 'stopped' &&
      m.purpose === 'e2e' &&
      m.auditStarted &&
      m.images &&
      !m.runToken,
    'audit-reuse-requires-own-stopped-audit-stand'
  )
  await assertNoSurvivors(m)
  const compiled = await compiledFingerprint(m.snapshot)
  // The manager creates this edge file after the author's snapshot. Its original
  // bytes remain bound by the recorded complete fingerprint; no runtime file changes.
  invariant(compiled === m.compiledFingerprint, 'built-snapshot-changed')
  const generated = m.topology === 'host' ? ['docker/caddy/Caddyfile.product-admin-stand'] : []
  invariant(
    (await compiledFingerprint(m.snapshot, generated)) === (await compiledFingerprint(root)),
    'compiled-inputs-changed-rebuild-required'
  )
  m.buildSourceHash ??= m.sourceHash
  m.compiledFingerprint = compiled
  await rm(join(directory(id), 'tmp'), { recursive: true, force: true })
  delete m.testOutcome
  await rm(join(m.snapshot, 'scripts'), { recursive: true })
  await cp(join(root, 'scripts'), join(m.snapshot, 'scripts'), { recursive: true })
  m.auditToolsHash = await toolingFingerprint(m.snapshot)
  invariant(m.auditToolsHash === (await toolingFingerprint(root)), 'audit-tool-copy-mismatch')
  delete m.audit
  await save(m)
  return m
}
