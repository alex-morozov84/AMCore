import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs'
import { join, resolve, relative, isAbsolute, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { root } from './migrator-operations/context.mjs'
import { context, buildkit } from './migrator-preparation/context.mjs'
import {
  resources,
  save,
  docker,
  command,
  cleanup,
  recover,
  label,
} from './migrator-preparation/resources.mjs'
import { safeError } from './migrator-lifecycle/safety.mjs'
const [argument, second] = process.argv.slice(2)
const requested = argument === '--cleanup' ? second : argument
assert.ok(requested && isAbsolute(requested), 'Use an absolute output directory')
const output = join(realpathSync(resolve(requested, '..')), requested.split(sep).at(-1))
const outside = (parent) => {
  const path = relative(realpathSync(parent), output)
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
}
assert.ok(outside(root), 'Keep generated artifacts outside the checkout')
if (existsSync(join(root, 'ai'))) {
  const privateRoot = realpathSync(join(root, 'ai'))
  assert.ok(outside(privateRoot), 'Raw artifacts must stay outside ai')
}
if (argument === '--cleanup') {
  await recover(output)
} else {
  assert.ok(
    argument && !second,
    'Usage: node scripts/verify-migrator-preparation.mjs /absolute/new/output; or --cleanup /absolute/output'
  )
  await run(output)
}
async function run(output) {
  let f
  const failures = []
  let interrupted
  const stop = (signal) => {
    interrupted = signal
    console.error(JSON.stringify({ verdict: 'INTERRUPTED', signal, output }))
  }
  const handlers = ['SIGINT', 'SIGTERM'].map((signal) => {
    const fn = () => stop(signal)
    process.on(signal, fn)
    return [signal, fn]
  })
  try {
    f = await resources(output)
    const directory = context(output)
    const arch = docker(f, ['info', '--format', '{{.Architecture}}']).trim()
    const native = { aarch64: 'arm64', arm64: 'arm64', x86_64: 'amd64', amd64: 'amd64' }[arch]
    assert.ok(native)
    const results = []
    for (const sample of ['a', 'b']) {
      assert.equal(interrupted, undefined, 'Interrupted preparation')
      const builder = `amcore-migrator-prep-${f.run}-${sample}`
      assert.ok(
        !docker(f, ['buildx', 'ls', '--format', '{{.Name}}']).trim().split('\n').includes(builder)
      )
      f.builders.push(builder)
      save(f)
      await command(f, [
        'buildx',
        'create',
        '--name',
        builder,
        '--driver',
        'docker-container',
        '--driver-opt',
        `image=${buildkit}`,
        '--driver-opt',
        `env.AMCORE_MIGRATOR_PREPARATION_RUN=${f.run}`,
        f.endpoint,
      ])
      const image = `${builder}:deployed`
      f.images.push(image)
      save(f)
      await command(f, [
        'buildx',
        'build',
        '--builder',
        builder,
        '--load',
        '--progress=plain',
        '--platform',
        `linux/${native}`,
        '--label',
        `${label}=${f.run}`,
        '--target',
        'migrator-dependencies',
        '-t',
        image,
        directory,
      ])
      const [artifact] = JSON.parse(docker(f, ['image', 'inspect', image]))
      assert.equal(artifact.Architecture, native)
      const name = `amcore-migrator-prep-${f.run}-${sample}-extract`
      f.containers.push(name)
      save(f)
      docker(f, ['create', '--name', name, '--label', `${label}=${f.run}`, image])
      for (const phase of ['installed', 'deployed'])
        docker(f, [
          'cp',
          `${name}:/verification/${phase}.json`,
          join(output, `${sample}-${phase}.json`),
        ])
      const result = JSON.parse(readFileSync(join(output, `${sample}-deployed.json`)))
      results.push(result)
      const offline = `amcore-migrator-prep-${f.run}-${sample}-offline`
      f.containers.push(offline)
      save(f)
      await command(f, [
        'run',
        '--rm',
        '--name',
        offline,
        '--label',
        `${label}=${f.run}`,
        '--network',
        'none',
        image,
        'sh',
        '-ec',
        'cd /prod/migrator; ./node_modules/.bin/prisma --version; /opt/pnpm/pnpm --version; sha256sum /opt/pnpm/pnpm; ldd /opt/pnpm/pnpm',
      ])
      writeFileSync(
        join(output, `${sample}-artifact.json`),
        JSON.stringify(
          {
            image: artifact.Id,
            architecture: native,
            buildkit,
            sourceImage: artifact.Config.Labels,
          },
          null,
          2
        ) + '\n'
      )
      if (sample === 'a') {
        const control = `${builder}:control`
        f.images.push(control)
        save(f)
        await command(f, [
          'buildx',
          'build',
          '--builder',
          builder,
          '--load',
          '--progress=plain',
          '--platform',
          `linux/${native}`,
          '--label',
          `${label}=${f.run}`,
          '--target',
          'hook-control',
          '-t',
          control,
          directory,
        ])
        const controlName = `amcore-migrator-prep-${f.run}-control-extract`
        f.containers.push(controlName)
        save(f)
        docker(f, ['create', '--name', controlName, '--label', `${label}=${f.run}`, control])
        for (const file of ['trace', 'forbidden-hooks'])
          docker(f, [
            'cp',
            `${controlName}:/verification/${file}.jsonl`,
            join(output, `positive-control-${file}.jsonl`),
          ])
      }
    }
    assert.deepEqual(
      results[0],
      results[1],
      'Independent deployed identities/engines/hooks/lock differ'
    )
    assert.deepEqual(
      JSON.parse(readFileSync(join(output, 'a-installed.json'))),
      JSON.parse(readFileSync(join(output, 'b-installed.json'))),
      'Independent install inventories differ'
    )
    assert.equal(interrupted, undefined, 'Interrupted preparation')
    const result = {
      run: f.run,
      verdict: 'CHECKS_PASSED',
      architecture: native,
      independentBuilders: 2,
      positiveControl: true,
      packages: results[0].packages.length,
      engines: results[0].engines,
      trace: results[0].trace,
      lockSha256: results[0].lockSha256,
      inventorySha256: createHash('sha256').update(JSON.stringify(results[0])).digest('hex'),
    }
    writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  } catch (error) {
    failures.push(error)
    console.error(JSON.stringify({ verdict: 'FAIL', output, error: safeError(error) }))
  }
  try {
    if (f) await cleanup(f)
  } catch (error) {
    failures.push(error)
    console.error(JSON.stringify({ verdict: 'CLEANUP_ERROR', output, error: safeError(error) }))
  }
  for (const [signal, fn] of handlers) process.off(signal, fn)
  if (failures.length || interrupted) process.exitCode = 1
  else {
    const result = JSON.parse(readFileSync(join(output, 'result.json')))
    result.verdict = 'PASS'
    result.cleanup = true
    writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  }
}
