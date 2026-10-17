import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createLintFixture } from '../../../../scripts/lib/lint-fixture.mjs'

let fixture: ReturnType<typeof createLintFixture>
beforeAll(() => {
  fixture = createLintFixture()
})
afterAll(() => fixture?.cleanup())
async function imports(code: string, filePath = 'e2e/mocked/fixture.spec.ts') {
  return fixture
    .lint(code, filePath)
    .filter((message: { ruleId: string }) => message.ruleId === 'no-restricted-imports')
}

describe('E2E accessibility entrypoint', () => {
  it.each(['@axe-core/playwright', 'axe-core'])(
    'rejects direct scans through %s',
    async (module) => {
      expect(await imports(`import scan from '${module}'; scan();`)).toHaveLength(1)
    }
  )
  it('allows the shared helper and axe result types', async () => {
    expect(
      await imports(
        "import { expectNoAxeViolations } from '../shared/axe'; expectNoAxeViolations(page); "
      )
    ).toEqual([])
    expect(
      await imports(
        "import type { Result } from 'axe-core'; const result: Result | undefined = undefined; void result;"
      )
    ).toEqual([])
  })
  it('allows the actual helper to own axe execution', () => {
    const cwd = path.resolve(import.meta.dirname, '../..')
    const helper = 'e2e/shared/axe.ts'
    expect(readFileSync(path.join(cwd, helper), 'utf8')).toContain('@axe-core/playwright')
    const run = spawnSync(
      process.execPath,
      [path.resolve(cwd, '../../scripts/lint.mjs'), '--scope', 'web', helper],
      { cwd, encoding: 'utf8' }
    )
    expect(run.error).toBeUndefined()
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0)
  })
})
