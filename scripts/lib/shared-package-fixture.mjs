import { cpSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
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
  symlinkSync(join(source, 'node_modules'), join(directory, 'node_modules'))
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
