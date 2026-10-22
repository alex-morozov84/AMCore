import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync, existsSync, lstatSync } from 'node:fs'
import { join, relative, basename } from 'node:path'
import { createHash } from 'node:crypto'

const registryPrepare = {
  'deepmerge-ts@8.0.2': 'husky',
  'foreground-child@3.3.1': 'tshy',
  'signal-exit@4.1.0':
    'tsc -p tsconfig.json && tsc -p tsconfig-esm.json && bash ./scripts/fixup.sh',
  'postgres@3.4.7': 'npm run build',
  'ret@0.5.0': 'tsc',
}
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
export function inventory(root) {
  const packages = [],
    engines = []
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile() && entry.name === 'package.json') {
        const pkg = JSON.parse(readFileSync(path, 'utf8'))
        if (pkg.name && pkg.version)
          packages.push({
            path: relative(root, path),
            name: pkg.name,
            version: pkg.version,
            manifestSha256: hash(path),
            hooks: Object.fromEntries(
              Object.entries(pkg.scripts ?? {}).filter(([name]) =>
                ['preinstall', 'install', 'postinstall', 'prepare'].includes(name)
              )
            ),
          })
      } else if (
        entry.isFile() &&
        /^(schema-engine-|query-engine-|libquery_engine)/.test(entry.name)
      ) {
        const bytes = readFileSync(path)
        if (bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])))
          engines.push({
            path: relative(root, path),
            sha256: hash(path),
            executable: Boolean(lstatSync(path).mode & 0o111),
          })
      }
    }
  }
  visit(root)
  packages.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  engines.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  assert.ok(packages.some((p) => p.name === 'prisma'))
  assert.ok(
    packages.filter((p) => p.name === 'typescript').every((p) => p.version === '5.9.3'),
    'Only the reviewed official TS5 peer belongs in the migrator graph'
  )
  assert.ok(
    !packages.some(
      (p) =>
        p.name === 'api' || p.name === '@typescript/native-preview' || p.name === '@nestjs/core'
    )
  )
  return { packages, engines }
}

function snapshot(mode, root) {
  const result = inventory(root)
  const allow = JSON.parse(readFileSync('/verification/allow-builds.json', 'utf8'))
  for (const pkg of result.packages)
    for (const [event, script] of Object.entries(pkg.hooks)) {
      if (event === 'prepare')
        assert.equal(
          registryPrepare[`${pkg.name}@${pkg.version}`],
          script,
          `Unknown published authoring hook: ${pkg.name}`
        )
      else assert.equal(allow[pkg.name], true, `Unexpected install hook: ${pkg.name}`)
    }
  assert.equal(
    existsSync('/verification/forbidden-hooks.jsonl'),
    false,
    'Forbidden workspace hook ran'
  )
  for (const path of [
    '/app/apps/api/node_modules',
    '/app/apps/web/node_modules',
    '/app/packages/shared/node_modules',
  ])
    assert.equal(existsSync(path), false, 'Unrelated workspace installation')
  result.lockSha256 = hash('/app/pnpm-lock.yaml')
  assert.equal(result.lockSha256, readFileSync('/verification/lock.sha256', 'utf8').trim())
  result.trace = existsSync('/verification/trace.jsonl')
    ? readFileSync('/verification/trace.jsonl', 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(JSON.parse)
    : []
  result.trace.sort((a, b) => `${a.name}:${a.event}`.localeCompare(`${b.name}:${b.event}`, 'en'))
  for (const hook of result.trace) {
    assert.equal(allow[hook.name], true, `Unexpected executed hook: ${hook.name}`)
    assert.ok(
      ['prisma:preinstall', '@prisma/engines:postinstall'].includes(`${hook.name}:${hook.event}`),
      'Unexpected executed lifecycle event'
    )
  }
  if (mode === 'installed')
    assert.equal(result.trace.length, 0, 'Ignore-scripts install executed a hook')
  else {
    assert.ok(
      result.engines.some((e) => basename(e.path).startsWith('schema-engine-') && e.executable)
    )
    for (const name of ['prisma', '@prisma/engines'])
      assert.ok(
        result.trace.some((h) => h.name === name),
        `Missing observed dependency hook: ${name}`
      )
  }
  writeFileSync(`/verification/${mode}.json`, JSON.stringify(result, null, 2) + '\n')
}
if (process.argv[1]?.endsWith('/inventory.mjs') && process.argv[2])
  snapshot(process.argv[2], process.argv[3])
