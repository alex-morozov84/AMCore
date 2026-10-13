import { randomUUID } from 'node:crypto'
import { unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

import { nativeConfig } from '@amcore/eslint-config/hybrid'
import { runResidual } from './lib/lint-eslint.mjs'

const ROOT = path.resolve(import.meta.dirname, '..')
const SCOPES = {
  root: '.',
  api: 'apps/api',
  web: 'apps/web',
  shared: 'packages/shared',
  config: 'packages/eslint-config',
}

function argumentsForScope(args) {
  const index = args.indexOf('--scope')
  const scope = args[index + 1]
  if (index < 0 || !Object.hasOwn(SCOPES, scope))
    throw new Error('Use --scope root|api|web|shared|config')
  args.splice(index, 2)
  const files = args.filter((arg) => !arg.startsWith('--'))
  const options = args.filter((arg) => arg.startsWith('--'))
  const supported = /^(--fix|--max-warnings=\d+|--no-warn-ignored|--format=json)$/
  if (options.some((arg) => !supported.test(arg))) throw new Error('Unsupported lint option')
  return { scope, files: files.length ? files : ['.'], options }
}

function execute(binary, args, cwd, capture) {
  const result = spawnSync(path.join(ROOT, 'node_modules/.bin', binary), args, {
    cwd,
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    env: process.env,
  })
  if (result.error) throw result.error
  if (result.signal) throw new Error(`${binary} terminated by ${result.signal}`)
  return { engine: binary, exit: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

async function lint() {
  const { scope, files, options } = argumentsForScope(process.argv.slice(2))
  const cwd = path.join(ROOT, SCOPES[scope])
  const configPath = path.join(cwd, scope === 'root' ? 'eslint.config.js' : 'eslint.config.mjs')
  process.chdir(cwd)
  const { policy, default: residualPolicy } = await import(pathToFileURL(configPath).href)
  if (!Array.isArray(policy)) throw new Error(`Missing paired lint policy: ${configPath}`)
  // Oxlint resolves scoped override patterns relative to its config directory.
  const config = path.join(cwd, `.oxlint-run-${randomUUID()}.json`)
  writeFileSync(config, JSON.stringify(nativeConfig(policy, cwd)), { flag: 'wx' })
  try {
    const nativeOptions = options.filter((arg) => arg !== '--no-warn-ignored')
    const capture = options.includes('--format=json')
    const native = execute(
      'oxlint',
      [
        '--config',
        config,
        '--report-unused-disable-directives-severity=warn',
        ...nativeOptions,
        ...files,
      ],
      cwd,
      capture
    )
    const residual = await runResidual({ cwd, config: residualPolicy, files, options, capture })
    if (capture) console.log(JSON.stringify({ scope, engines: [native, residual] }))
    return Math.max(native.exit, residual.exit)
  } finally {
    unlinkSync(config)
  }
}

try {
  process.exitCode = await lint()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
