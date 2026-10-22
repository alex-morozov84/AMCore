import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { root } from '../migrator-operations/context.mjs'
export const buildkit =
  'moby/buildkit:buildx-stable-1@sha256:cec9f139f45e93c5c69c60f8b07cfad9f43f4ef6b6a6cd917527fea5ff2e3dea'
export function context(output) {
  const directory = join(output, 'context')
  const verification = join(directory, 'verification')
  mkdirSync(verification, { recursive: true })
  const dockerfile = readFileSync(join(root, 'apps/api/Dockerfile'), 'utf8')
  const stage = dockerfile.slice(
    dockerfile.indexOf('FROM ghcr.io/pnpm/pnpm:'),
    dockerfile.indexOf('# Do not inherit build tooling')
  )
  assert.ok(stage.includes('AS migrator-dependencies'))
  const install =
    'HUSKY=0 pnpm --filter @amcore/migrator --fail-if-no-match install --prod --frozen-lockfile --ignore-scripts'
  const deploy =
    'HUSKY=0 pnpm --filter @amcore/migrator --fail-if-no-match deploy --prod /prod/migrator'
  assert.ok(stage.includes(install) && stage.includes(deploy), 'Review changed production commands')
  const prefix = stage.slice(0, stage.indexOf('RUN --mount=type=cache'))
  assert.ok(prefix.includes('ENV pnpm_config_frozen_lockfile=true'))
  const paths = [
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'apps/api/package.json',
    'apps/web/package.json',
    'packages/shared/package.json',
    'packages/eslint-config/package.json',
    'packages/typescript-config/package.json',
    'docker/migrator/package.json',
  ]
  const originals = {}
  for (const path of paths) {
    const source = join(root, path),
      target = join(directory, path)
    mkdirSync(dirname(target), { recursive: true })
    const bytes = readFileSync(source)
    originals[path] = createHash('sha256').update(bytes).digest('hex')
    if (path.endsWith('package.json') && path !== 'docker/migrator/package.json') {
      const pkg = JSON.parse(bytes)
      for (const event of ['preinstall', 'install', 'postinstall', 'prepare']) {
        pkg.scripts ??= {}
        pkg.scripts[event] = `node /verification/sentinel.cjs ${path}:${event}`
      }
      writeFileSync(target, JSON.stringify(pkg, null, 2) + '\n')
    } else copyFileSync(source, target)
  }
  const expected = /^pnpm@(\d+\.\d+\.\d+)$/.exec(
    JSON.parse(readFileSync(join(root, 'package.json'))).packageManager
  )?.[1]
  assert.equal(
    execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8' }).trim(),
    expected
  )
  const allow = execFileSync('pnpm', ['config', 'get', 'allowBuilds', '--json'], {
    cwd: root,
    encoding: 'utf8',
  })
  assert.equal(JSON.parse(allow).prisma, true)
  writeFileSync(join(verification, 'allow-builds.json'), allow)
  writeFileSync(join(verification, 'lock.sha256'), originals['pnpm-lock.yaml'] + '\n')
  copyFileSync(new URL('./inventory.mjs', import.meta.url), join(verification, 'inventory.mjs'))
  writeFileSync(
    join(verification, 'trace.cjs'),
    `const fs=require('node:fs');if(process.env.npm_lifecycle_event){const p=JSON.parse(fs.readFileSync('package.json','utf8'));fs.appendFileSync('/verification/trace.jsonl',JSON.stringify({name:p.name,event:process.env.npm_lifecycle_event})+'\\n')}`
  )
  writeFileSync(
    join(verification, 'sentinel.cjs'),
    `require('node:fs').appendFileSync('/verification/forbidden-hooks.jsonl',JSON.stringify({hook:process.argv[2]})+'\\n');process.exit(77)`
  )
  writeFileSync(
    join(verification, 'control.json'),
    JSON.stringify({
      name: 'amcore-hook-control',
      version: '1.0.0',
      private: true,
      scripts: { prepare: 'node /verification/sentinel.cjs positive-control:prepare' },
    })
  )
  writeFileSync(
    join(verification, 'check-control.cjs'),
    `const fs=require('node:fs'),assert=require('node:assert/strict');const trace=fs.readFileSync('/verification/trace.jsonl','utf8').trim().split('\\n').map(JSON.parse);assert.ok(trace.some(x=>x.name==='amcore-hook-control'&&x.event==='prepare'));const marker=fs.readFileSync('/verification/forbidden-hooks.jsonl','utf8').trim().split('\\n').map(JSON.parse);assert.deepEqual(marker,[{hook:'positive-control:prepare'}]);`
  )
  const body = `${prefix}\nCOPY verification /verification\nENV NODE_OPTIONS=--require=/verification/trace.cjs\nRUN ${install}\nRUN node /verification/inventory.mjs installed /app/node_modules\nRUN ${deploy}\nRUN node /verification/inventory.mjs deployed /prod/migrator/node_modules\nFROM migrator-dependencies AS hook-control\nWORKDIR /control\nCOPY verification/control.json ./package.json\nRUN if HUSKY=0 pnpm install --offline --no-frozen-lockfile; then exit 1; else test -s /verification/forbidden-hooks.jsonl; fi\nRUN node /verification/check-control.cjs\n`
  writeFileSync(join(directory, 'Dockerfile'), body)
  writeFileSync(
    join(output, 'source-inputs.json'),
    JSON.stringify(
      {
        originals,
        expectedPnpm: expected,
        fixtureOnlyChanges:
          'workspace lifecycle sentinels + external observer; Prisma files unchanged',
      },
      null,
      2
    ) + '\n'
  )
  return directory
}
