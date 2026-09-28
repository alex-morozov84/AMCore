import { projectChoices } from './project.mjs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
// AMCORE_CONSOLE_HOST_IMPORTS_START
import { readFile, writeFile } from 'node:fs/promises'
// AMCORE_CONSOLE_HOST_IMPORTS_END
import { directory, save } from './state.mjs'
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
  // AMCORE_CONSOLE_HOST_SNAPSHOT_START
  if (m.topology === 'host') {
    const file = join(destination, 'apps/web/src/shared/lib/admin-console.generated.ts')
    const content = await readFile(file, 'utf8')
    if (!content.includes('enabled: true')) throw new Error('Console host unavailable')
    await writeFile(file, content.replace("mode: 'path'", "mode: 'host'"))
  }
  // AMCORE_CONSOLE_HOST_SNAPSHOT_END
  await save(m)
}
