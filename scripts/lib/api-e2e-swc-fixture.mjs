import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { api, root, jest } from '../api-e2e/paths.mjs'
import { supervise, readRows } from '../api-e2e/process.mjs'

const require = createRequire(join(api, 'package.json'))
const configuration = require(join(api, 'jest-e2e.config.js'))
const output = join(root, '.amcore/j-lifecycle')

export async function exercise(id, body) {
  const directory = mkdtempSync(join(api, 'jest-swc-contract-'))
  const path = join(directory, 'case.e2e-spec.ts')
  const progress = join(directory, 'progress.jsonl')
  const final = join(directory, 'final.json')
  const config = { ...configuration, rootDir: api, testMatch: [path] }
  // Jest resolves transformer paths from rootDir, including the shared SWC options.
  writeFileSync(path, `import { test, expect } from '@jest/globals';\n${body}`)
  try {
    if (id === 'signal-handler-zero') {
      writeFileSync(
        join(directory, 'native-signal.cjs'),
        "const exit = process.exit.bind(process); process.on('SIGTERM',()=>exit(0));"
      )
    }
    const args = [
      '--max-old-space-size=1024',
      '--experimental-vm-modules',
      ...(id === 'signal-handler-zero' ? ['--require', join(directory, 'native-signal.cjs')] : []),
      jest,
      '--runInBand',
      '--ci',
      '--config',
      JSON.stringify(config),
      '--reporters',
      join(root, 'scripts/api-e2e/reporter.cjs'),
      '--runTestsByPath',
      path,
    ]
    const result = await supervise(process.execPath, args, {
      cwd: api,
      progress,
      wallMilliseconds: 15000,
      exitMilliseconds: 1200,
      termMilliseconds: 300,
      killMilliseconds: 200,
      env: {
        ...process.env,
        AMCORE_E2E_PROGRESS: progress,
        AMCORE_E2E_FINAL: final,
        AMCORE_E2E_ATTEMPT: id,
      },
    })
    const attempt = {
      ...result,
      id,
      absolutePath: path,
      clean: true,
      rows: readRows(progress),
      final: existsSync(final) ? JSON.parse(readFileSync(final)) : null,
    }
    mkdirSync(output, { recursive: true })
    writeFileSync(
      join(output, `${id}.json`),
      JSON.stringify({ args, body, config, attempt }, null, 2)
    )
    return attempt
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
