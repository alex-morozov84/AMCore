import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { snapshot } from '../stand/snapshot.mjs'

const source = resolve(import.meta.dirname, '../..')
const fixture = await mkdtemp(join(tmpdir(), 'amcore-roles-headless-'))
await snapshot(source, fixture)
// Stand snapshots need a Git source inventory; this temporary repository has no commits.
execFileSync('git', ['init', '--quiet'], { cwd: fixture })
const page = 'apps/web/src/_pages/custom-roles'
await mkdir(join(fixture, page, 'ui'), { recursive: true })
await writeFile(
  join(fixture, page, 'ui/custom-roles.tsx'),
  await readFile(join(import.meta.dirname, 'organization-roles-headless-client.tsx.fixture'))
)
await writeFile(
  join(fixture, page, 'index.ts'),
  "export { CustomRoles } from './ui/custom-roles'\n"
)
// The ready product has no roles screen yet, so the fixture adds its own mount and route in the copy only.
await writeFile(
  join(fixture, 'apps/web/src/_app/organization-access/ui/custom-roles-mount.tsx'),
  `import { notFound } from 'next/navigation'
import { isOrganizationContextId } from '@amcore/shared'

import { CustomRoles } from '@/_pages/custom-roles'
import { redirectToLogin } from '@/shared/api/bff/dal'
import { SessionNotFoundError } from '@/shared/api/bff/errors'

import { safeOrganizationAdmission } from '../model/admission.server'

import 'server-only'

export async function CustomRolesMount({ id }: { id: string }) {
  if (!isOrganizationContextId(id)) notFound()
  try {
    return <CustomRoles admission={await safeOrganizationAdmission()} id={id} />
  } catch (error) {
    if (error instanceof SessionNotFoundError) return redirectToLogin()
    throw error
  }
}
`
)
const route = join(
  fixture,
  'apps/web/src/app/[locale]/(organization-access)/organizations/[id]/roles'
)
await mkdir(route, { recursive: true })
await writeFile(
  join(route, 'page.tsx'),
  `import { CustomRolesMount } from '@/_app/organization-access/ui/custom-roles-mount'

export const dynamic = 'force-dynamic'
export default async function Roles({ params }: { params: Promise<{ id: string }> }) {
  return <CustomRolesMount id={(await params).id} />
}
`
)
await writeFile(
  join(fixture, 'apps/web/e2e/real-stack/organization-roles-headless.spec.ts'),
  await readFile(join(import.meta.dirname, 'organization-roles-headless.spec.ts.fixture'), 'utf8')
)
console.log(`Prepared custom-roles headless fixture: ${fixture}`)
console.log(
  `Install dependencies first: pnpm --dir ${fixture} install --frozen-lockfile --ignore-scripts\nRun: pnpm --dir ${fixture} stand e2e --lane real-stack -- organization-roles-headless.spec.ts`
)
