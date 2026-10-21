import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

export function verifyConsumer(root, packageRoot, consumer, expectedValues) {
  const installed = join(consumer, 'node_modules/@amcore/shared')
  mkdirSync(installed, { recursive: true })
  cpSync(join(packageRoot, 'dist'), join(installed, 'dist'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json')))
  delete manifest.devDependencies
  delete manifest.scripts
  writeFileSync(join(installed, 'package.json'), JSON.stringify(manifest))
  const requireShared = createRequire(join(root, 'packages/shared/package.json'))
  const zod = realpathSync(join(requireShared.resolve('zod'), '..'))
  cpSync(zod, join(consumer, 'node_modules/zod'), { recursive: true })
  verifyTypes(root, installed, consumer)
  verifyRuntime(consumer, expectedValues)
}

function verifyTypes(root, installed, consumer) {
  const fixture = readFileSync(join(root, 'scripts/fixtures/shared-package.types.txt'))
  const compiler = join(root, 'node_modules/typescript/bin/tsc')
  for (const [resolution, extension] of [
    ['NodeNext', 'mts'],
    ['NodeNext', 'cts'],
    ['Bundler', 'mts'],
  ]) {
    writeFileSync(join(consumer, `fixture.${extension}`), fixture)
    writeFileSync(
      join(consumer, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          noEmit: true,
          strict: true,
          skipLibCheck: false,
          lib: ['ES2022', 'DOM'],
          module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext',
          moduleResolution: resolution,
        },
        files: [`fixture.${extension}`],
      })
    )
    const trace = execFileSync(
      process.execPath,
      [compiler, '-p', 'tsconfig.json', '--traceResolution'],
      {
        cwd: consumer,
        stdio: 'pipe',
        encoding: 'utf8',
      }
    )
    const resolved = trace.match(
      /Module name '@amcore\/shared' was successfully resolved to '([^']+)'/
    )
    assert.ok(resolved, 'Missing shared package resolution trace')
    assert.equal(realpathSync(resolved[1]), realpathSync(join(installed, 'dist/index.d.ts')))
  }
}

function verifyRuntime(consumer, expectedValues) {
  const checks = `
    assert.equal(s.registerSchema.parse({email:'a@b.com',password:'Password1',name:''}).name, undefined);
    assert.equal(s.registerSchema.parse({email:'a@b.com',password:'Password1',name:'Alice'}).name, 'Alice');
    assert.equal(s.registerSchema.safeParse({email:'a@b.com',password:'Password1',name:12}).success, false);
    assert.equal(s.paginationQuerySchema.parse({page:'2'}).page, 2);
    console.log(JSON.stringify(Object.keys(s).sort()));`
  const common = execFileSync(
    process.execPath,
    [
      '-e',
      `const assert=require('node:assert/strict');const s=require('@amcore/shared');${checks}`,
    ],
    { cwd: consumer }
  )
  const esm = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import assert from 'node:assert/strict';import * as s from '@amcore/shared';${checks}`,
    ],
    { cwd: consumer }
  )
  assert.deepEqual(JSON.parse(common), JSON.parse(esm))
  if (expectedValues) assert.deepEqual(JSON.parse(common), expectedValues)
}

export function verifyMaps(packageRoot) {
  for (const name of ['index.js', 'index.cjs', 'index.d.ts', 'index.d.cts']) {
    const content = readFileSync(join(packageRoot, 'dist', name), 'utf8')
    assert.equal(content.length > 0, true)
    if (name.endsWith('.ts') || name.endsWith('.cts')) {
      assert.equal(content.includes('sourceMappingURL='), false)
      continue
    }
    const url = content.match(/sourceMappingURL=(.+)/)?.[1].trim()
    assert.equal(url, `${name}.map`)
    const map = JSON.parse(readFileSync(join(packageRoot, 'dist', url)))
    assert.equal(map.sources.length > 0, true)
    assert.equal(map.sources.length, map.sourcesContent.length)
    assert.equal(
      map.sourcesContent.every(
        (source, index) =>
          (typeof source === 'string' && source.length > 0) ||
          // Rolldown's JSON loader emits this source without embedded content.
          // Keep the exception exact; every TypeScript source still needs content.
          (source === '' && map.sources[index] === '../src/config/product-admin.json')
      ),
      true
    )
  }
}
