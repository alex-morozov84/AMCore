import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

import { buildProjectFactPlan } from '../../../../scripts/lib/project-fact-plan.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const web = path.resolve(here, '../..')
const root = path.resolve(web, '../..')
const story = 'apps/web/src/features/invitation-acceptance/ui/invitation-consent.stories.tsx'
const fixture = realpathSync(mkdtempSync(path.join(tmpdir(), 'amcore-consent-play-')))

function materializeStory(locale) {
  const plan = buildProjectFactPlan(root, { mode: 'single', locale }, 'admin')
  const step = plan.localeSteps.find((item) => item.target === path.join(root, story))
  if (step?.kind !== 'edit') throw new Error('retained consent story edit missing')
  const source = step.after
    .replaceAll("'../../../../messages/", `'${web}/messages/`)
    .replaceAll("'./invitation-consent'", `'${web}/src/features/invitation-acceptance/ui/invitation-consent'`)
    .replaceAll("'./invitation-consent.fixture'", `'${web}/src/features/invitation-acceptance/ui/invitation-consent.fixture'`)
  writeFileSync(path.join(fixture, `${locale}.stories.tsx`), source)
}

try {
  for (const locale of ['en', 'ru']) materializeStory(locale)
  symlinkSync(path.join(web, 'node_modules'), path.join(fixture, 'node_modules'))
  writeFileSync(path.join(fixture, 'play.test.tsx'), readFileSync(path.join(here, 'consent.test.tsx.fixture')))
  const config = readFileSync(path.join(here, 'vitest.config.mjs.fixture'), 'utf8')
    .replace('FIXTURE_ROOT', JSON.stringify(fixture))
    .replace('WEB_SOURCE_ROOT', JSON.stringify(path.join(web, 'src')))
  const configPath = path.join(fixture, 'vitest.config.mjs')
  writeFileSync(configPath, config)
  const result = spawnSync(process.execPath, [path.join(web, 'node_modules/vitest/vitest.mjs'), 'run', '--config', configPath, '--reporter=dot'], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(fixture, { recursive: true, force: true })
}
