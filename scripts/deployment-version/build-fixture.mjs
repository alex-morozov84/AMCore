import { execFileSync } from 'node:child_process'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'

export async function buildFixture(root, workspace, version) {
  const source = join(workspace, `source-${version}`)
  const ignored = new Set(['ai', '.git', '.worktrees', '.next', '.env', 'playwright-report'])
  // Turbopack rejects dependencies symlinked outside its filesystem root.
  // Copy installed modules, preserving their internal relative symlinks.
  await cp(root, source, {
    recursive: true,
    verbatimSymlinks: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (path) =>
      !ignored.has(basename(path)) &&
      !(basename(path).startsWith('.env.') && basename(path) !== '.env.example'),
  })
  const fixture = join(source, 'apps/web/src/app/[locale]/deployment-probe')
  await mkdir(fixture, { recursive: true })
  await writeFile(
    join(fixture, 'actions.ts'),
    `'use server'
export async function action${version}() { return '${version}' }
`
  )
  await writeFile(
    join(fixture, 'page.tsx'),
    `import { Timer } from './timer'
export default function Page() { return <><h1>Build ${version}</h1><Timer /></> }
`
  )
  await writeFile(
    join(fixture, 'timer.tsx'),
    `'use client'
import { useEffect } from 'react'
import { action${version} } from './actions'
export function Timer() {
  useEffect(() => {
    if (!location.search.includes('poll=1')) return
    const timer = setInterval(() => { void action${version}().catch(() => undefined) }, 500)
    return () => clearInterval(timer)
  }, [])
  return null
}
`
  )
  execFileSync(
    process.execPath,
    [join(source, 'apps/web/node_modules/next/dist/bin/next'), 'build'],
    {
      cwd: join(source, 'apps/web'),
      stdio: 'inherit',
      env: { ...process.env, NEXT_DEPLOYMENT_ID: `version-test-${version}` },
    }
  )
  const artifact = join(workspace, version)
  await cp(join(source, 'apps/web/.next/standalone'), artifact, { recursive: true })
  await cp(join(source, 'apps/web/.next/static'), join(artifact, 'apps/web/.next/static'), {
    recursive: true,
  })
  await cp(join(source, 'apps/web/public'), join(artifact, 'apps/web/public'), { recursive: true })
  return artifact
}
