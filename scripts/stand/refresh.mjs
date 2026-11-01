import { prepareProductAdminSource } from './product-admin-source.mjs'
import { prepareAccountMfaPreview } from './account-mfa-source.mjs'
import { projectChoices } from './project.mjs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { directory, save } from './state.mjs'
import { prepareOrganizationSetupSource } from './organization-setup-fixture.mjs'
import { snapshot } from './snapshot.mjs'

export async function refresh(m) {
  const choices = await projectChoices(m.worktree)
  Object.assign(m, {
    consoleEnabled: choices.consoleEnabled,
    consoleSlug: choices.consoleSlug,
    localePrefix: choices.localePrefix,
    baseLocale: choices.baseLocale,
    branch: choices.branch,
  })
  const destination = join(directory(m.id), `source-${randomUUID()}`)
  const hash = await snapshot(m.worktree, destination)
  m.approvedSnapshots = [...new Set([...(m.approvedSnapshots ?? []), m.snapshot, destination])]
  m.snapshot = destination
  if (hash !== m.sourceHash) delete m.images
  m.sourceHash = hash
  await prepareOrganizationSetupSource(m)
  if (
    m.topology === 'host' &&
    (!m.productAdminHost || (m.consoleEnabled && m.consoleTopology === 'host'))
  ) {
    const file = join(destination, 'apps/web/src/shared/lib/admin-console.generated.ts')
    const content = await readFile(file, 'utf8')
    if (!content.includes('enabled: true')) throw new Error('Console host unavailable')
    await writeFile(file, content.replace("mode: 'path'", "mode: 'host'"))
  }
  await prepareProductAdminSource(m)
  await prepareAccountMfaPreview(m)
  await save(m)
}
