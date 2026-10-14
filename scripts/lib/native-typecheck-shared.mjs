import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function verifyNativeConsumer(root, consumer) {
  const original = readFileSync(join(root, 'scripts/fixtures/shared-package.types.txt'), 'utf8')
  const extra = readFileSync(join(root, 'scripts/fixtures/shared-package-native.types.txt'), 'utf8')
  for (const resolution of ['NodeNext', 'Bundler']) {
    for (const [extension, specifier] of [
      ['mts', '@amcore/shared'],
      ['cts', '@amcore/shared'],
      ['mts', './node_modules/@amcore/shared/dist/index.js'],
      ['cts', './node_modules/@amcore/shared/dist/index.cjs'],
    ])
      verifyCase(root, consumer, resolution, extension, specifier, original + extra)
  }
}

function verifyCase(root, consumer, resolution, extension, specifier, source) {
  const file = join(consumer, `native.${extension}`)
  writeFileSync(file, source.replaceAll("'@amcore/shared'", JSON.stringify(specifier)))
  const config = join(consumer, 'native.json')
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: false,
        target: 'ES2022',
        lib: ['ES2022', 'DOM'],
        types: [],
        module: resolution === 'NodeNext' ? 'NodeNext' : 'Preserve',
        moduleResolution: resolution,
      },
      files: [file],
    })
  )
  const args = [
    join(root, 'scripts/typecheck-native.mjs'),
    '--noEmit',
    '-p',
    config,
    '--pretty',
    'false',
  ]
  const options = { cwd: join(root, 'packages/shared'), encoding: 'utf8', timeout: 15000 }
  const good = spawnSync(process.execPath, [...args, '--traceResolution'], options)
  assert.equal(good.status, 0, good.stdout + good.stderr)
  const declaration = specifier.endsWith('index.cjs') ? 'index.d.cts' : 'index.d.ts'
  assert.ok(good.stdout.includes(`/dist/${declaration}`), good.stdout)
  writeFileSync(
    file,
    source.replaceAll("'@amcore/shared'", JSON.stringify(specifier)) +
      "\nconst explicitBadName: z.output<typeof registerSchema>['name'] = 42;\n"
  )
  const bad = spawnSync(process.execPath, args, options)
  const codes = [...(bad.stdout + bad.stderr).matchAll(/error TS(\d+)/g)].map((m) => Number(m[1]))
  assert.notEqual(bad.status, 0)
  assert.deepEqual(codes, [2322], bad.stdout + bad.stderr)
}
