// init:project --mode=single: eslint-guards.test.ts's own coverage of the
// navigation-import ban. project-plan-web-config.mjs removes that rule (and
// its navigation.ts-scoped exemption) from eslint.config.mjs once [locale]
// and i18n/navigation.ts are gone, so the 4 tests asserting it still exists
// would fail against the post-transform config. Targeted block removal, not
// exactContentStep: this file's Zod-locale, FSD-boundaries, and
// token-styling coverage is unrelated and must survive untouched. Also
// fixes the FSD cross-slice-import test, found via the real `pnpm --filter
// web test` in init-project.test.mjs: it used the deleted
// `@/features/locale-switcher` slice as its "some other feature" probe.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const NAVIGATION_IMPORT_BAN_TESTS = `  it('bans locale-unaware navigation imports', async () => {
    const messages = await lint(
      \`import Link from 'next/link'\\nexport const L = Link\\n\`,
      'src/guard-fixture.ts'
    )

    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports')
    expect(messages[0]?.message).toMatch(/@\\/i18n\\/navigation/)
  })

  it('bans locale-unaware navigation hooks', async () => {
    expect(
      await ruleIds(
        \`import { useRouter } from 'next/navigation'\\nexport const r = useRouter\\n\`,
        'src/guard-fixture.ts'
      )
    ).toContain('no-restricted-imports')
  })

`

const LEAVES_COMPLIANT_CODE_ALONE_TEST = `
  it('leaves compliant code alone', async () => {
    expect(
      await ruleIds(
        \`import { Link } from '@/i18n/navigation'\\nexport const L = Link\\n\`,
        'src/guard-fixture.ts'
      )
    ).toHaveLength(0)
  })`

const NAVIGATION_SOURCE_EXEMPTION_TEST = `  it('still bans layer barrels inside the navigation source file', async () => {
    // \`src/i18n/navigation.ts\` is exempted from the navigation ban over a strict
    // subset of files. That block restates the layer-barrel pattern; if someone
    // drops it, the exemption silently widens.
    expect(
      await ruleIds(
        \`import * as x from '@/features'\\nexport const y = x\\n\`,
        'src/i18n/navigation.ts'
      )
    ).toContain('no-restricted-imports')
  })

`

function eslintGuardsTransform(content) {
  let next = removeExactBlock(content, NAVIGATION_IMPORT_BAN_TESTS)
  next = removeExactBlock(next, LEAVES_COMPLIANT_CODE_ALONE_TEST)
  next = removeExactBlock(next, NAVIGATION_SOURCE_EXEMPTION_TEST)
  return replaceExactBlock(
    next,
    "      'a slice may not import a sibling feature slice',\n      'src/features/auth-login/probe.ts',\n      \"'@/features/locale-switcher'\",\n",
    "      'a slice may not import a sibling feature slice',\n      'src/features/auth-login/probe.ts',\n      \"'@/features/auth-logout'\",\n"
  )
}

export function buildWebNavEslintGuardsSteps(root) {
  return [
    fileStep(
      path.join(root, 'apps/web/src/test/eslint-guards.test.ts'),
      eslintGuardsTransform,
      'eslint-guards.test.ts: drop coverage of the removed navigation-import ban'
    ),
  ]
}
