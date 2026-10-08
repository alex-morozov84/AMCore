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
  let admission
  try {
    admission = await safeOrganizationAdmission()
  } catch (error) {
    if (error instanceof SessionNotFoundError) return redirectToLogin()
    throw error
  }
  return <CustomRoles admission={admission} id={id} />
}
`
)
// A route may import composition only through its public server entry (FSD boundary), so the copy's
// entry exports the fixture mount exactly like it exports the ready ones.
const serverEntry = join(fixture, 'apps/web/src/_app/organization-access/index.server.ts')
const entry = await readFile(serverEntry, 'utf8')
const anchor = "export { OrganizationInvitationsMount } from './ui/invitations-mount'"
if (!entry.includes(anchor))
  throw new Error('Server entry layout changed; update the fixture generator')
// Placed in module-path order so the copy still satisfies the repository export-sorting rule.
await writeFile(
  serverEntry,
  entry.replace(anchor, "export { CustomRolesMount } from './ui/custom-roles-mount'\n" + anchor)
)
const route = join(
  fixture,
  'apps/web/src/app/[locale]/(organization-access)/organizations/[id]/roles'
)
await mkdir(route, { recursive: true })
await writeFile(
  join(route, 'page.tsx'),
  `import { CustomRolesMount } from '@/_app/organization-access/index.server'

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
  `Install dependencies first: pnpm --dir ${fixture} install --frozen-lockfile --ignore-scripts\nBuild the shared package and check the generated code against the repository rules (targets present): pnpm --dir ${fixture} --filter shared build && pnpm --dir ${fixture}/apps/web exec eslint src/_app/organization-access src/_pages/custom-roles 'src/app/[locale]/(organization-access)/organizations/[id]/roles/page.tsx' && pnpm --dir ${fixture}/apps/web exec tsc --noEmit\nRun: pnpm --dir ${fixture} stand e2e --lane real-stack -- organization-roles-headless.spec.ts`
)
