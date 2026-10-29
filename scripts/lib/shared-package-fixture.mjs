import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export const root = fileURLToPath(new URL('../../', import.meta.url))
export function copyShared(directory) {
  const source = join(root, 'packages/shared')
  for (const name of ['src', 'package.json', 'tsconfig.json', 'tsdown.config.ts'])
    cpSync(join(source, name), join(directory, name), { recursive: true })
  const manifestPath = join(directory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath))
  manifest.packageManager = JSON.parse(readFileSync(join(root, 'package.json'))).packageManager
  writeFileSync(manifestPath, JSON.stringify(manifest))
  linkDependencies(source, directory)
}

// Observe completed format builds without changing the package's build behavior.
export function observeSharedBuilds(directory) {
  renameSync(join(directory, 'tsdown.config.ts'), join(directory, 'tsdown.base.config.ts'))
  writeFileSync(
    join(directory, 'tsdown.config.ts'),
    `import config from './tsdown.base.config.ts'
export default {
  ...config,
  hooks: {
    ...config.hooks,
    'build:done': async (context) => {
      await config.hooks['build:done'](context)
      console.log('SHARED_BUILD_DONE:' + context.options.format)
    },
  },
}
`
  )
}

// pnpm shell launchers contain relative paths that break through a directory symlink.
// Link package entrypoints directly so this external fixture keeps real CLI resolution.
function linkDependencies(source, directory) {
  const installed = join(source, 'node_modules')
  const local = join(directory, 'node_modules')
  mkdirSync(join(local, '.bin'), { recursive: true })
  for (const entry of readdirSync(installed)) {
    if (entry !== '.bin') symlinkSync(join(installed, entry), join(local, entry))
  }
  const compilerRoot = join(installed, 'tsdown')
  const compiler = JSON.parse(readFileSync(join(compilerRoot, 'package.json')))
  symlinkSync(realpathSync(join(compilerRoot, compiler.bin.tsdown)), join(local, '.bin', 'tsdown'))
}

// Exercise the manifest command: the compiler binary alone does not prove package wiring.
export function build(directory) {
  return execFileSync('pnpm', ['run', 'build'], {
    cwd: directory,
    stdio: 'pipe',
    timeout: 30_000,
    // Tools are intentionally linked into this owned copy; never install into their target.
    env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
  })
}
