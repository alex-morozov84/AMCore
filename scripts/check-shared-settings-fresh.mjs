import { fileURLToPath } from 'node:url'

import { sharedSettingsProblems } from './lib/shared-settings-fresh.mjs'

const problems = await sharedSettingsProblems(fileURLToPath(new URL('../', import.meta.url)))
if (problems.length) {
  console.error(
    `packages/shared/dist is older than its settings files:\n- ${problems.join('\n- ')}`
  )
  console.error('Run: pnpm --filter @amcore/shared build')
  process.exit(1)
}
