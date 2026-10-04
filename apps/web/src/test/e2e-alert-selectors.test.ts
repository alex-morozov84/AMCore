import { readdirSync } from 'node:fs'
import path from 'node:path'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const webRoot = path.resolve(import.meta.dirname, '../..')
const eslint = new ESLint({ cwd: webRoot })

async function violations(code: string, filePath = 'e2e/real-stack/alert-fixture.spec.ts') {
  const [result] = await eslint.lintText(code, { filePath })
  return result!.messages.filter((message) => message.ruleId === 'no-restricted-syntax')
}

describe('E2E alert selector guard', () => {
  it.each([
    "page.getByRole('alert')",
    `page.locator('[role="alert"]')`,
    `page.locator("[role='alert']")`,
    "page.locator('[role=alert]')",
  ])('rejects the global alert query %s', async (code) => {
    const messages = await violations(code)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.message).toContain('route announcer')
  })

  it.each([
    `page.locator('[data-slot="alert"][role="alert"]')`,
    "page.locator('main').getByRole('alert')",
    "page.getByRole('alert', { name: 'Error' })",
    "page.getByRole('alertdialog')",
  ])('allows the scoped or distinct query %s', async (code) => {
    expect(await violations(code)).toEqual([])
  })

  it('covers every browser lane', async () => {
    const e2eRoot = path.join(webRoot, 'e2e')
    const lanes = readdirSync(e2eRoot, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          readdirSync(path.join(e2eRoot, entry.name), { recursive: true }).some((file) =>
            String(file).endsWith('.spec.ts')
          )
      )
      .map((entry) => entry.name)
    expect(lanes.length).toBeGreaterThan(0)
    for (const lane of lanes)
      expect(
        await violations("page.getByRole('alert')", `e2e/${lane}/fixture.spec.ts`)
      ).toHaveLength(1)
  })
})
