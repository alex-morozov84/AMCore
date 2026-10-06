import path from 'node:path'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint({ cwd: path.resolve(import.meta.dirname, '../..') })
async function imports(code: string, filePath = 'e2e/mocked/fixture.spec.ts') {
  const [result] = await eslint.lintText(code, { filePath })
  return result!.messages.filter((message) => message.ruleId === 'no-restricted-imports')
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
  it('allows the actual helper to own axe execution', async () => {
    expect(
      await imports(
        "import AxeBuilder from '@axe-core/playwright'; new AxeBuilder({ page });",
        'e2e/shared/axe.ts'
      )
    ).toEqual([])
  })
})
