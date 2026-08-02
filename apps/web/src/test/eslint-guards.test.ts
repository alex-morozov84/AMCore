// The repository's custom ESLint rules are contract guards, and `ai/TESTING.md`
// asks the same of them as of any other guard: derive from the source of truth,
// don't be vacuous, and prove they fail on the case they exist for.
//
// They needed it. `project/zod-locale` shipped in #267 and was silently
// disabled the same day by #270: both blocks configured `no-restricted-syntax`
// for `src/**`, and ESLint flat config *replaces* a rule's options rather than
// merging them, so the later block won. The ban survived only in test files —
// the one place #270's block was `ignores`d — which is why nothing caught it:
// it forbade `z.config` exactly where nobody writes it.
//
// Hence two kinds of check below. The behavioural ones prove each guard bites
// today. The structural one is the reason this cannot silently regress: it
// derives from the config, so it covers guards that do not exist yet.

import path from 'node:path'

import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import config from '../../eslint.config.mjs'

const WEB_ROOT = path.resolve(import.meta.dirname, '../..')

async function lint(code: string, filePath: string) {
  const eslint = new ESLint({ cwd: WEB_ROOT })
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages
}

/** Rule ids reported for `code`, restricted to the rule under test. */
async function ruleIds(code: string, filePath: string) {
  return (await lint(code, filePath)).map((m) => m.ruleId)
}

describe('custom ESLint guards fire on the defect they exist for', () => {
  it('bans a global Zod locale in application code', async () => {
    const messages = await lint(
      `import { z } from 'zod'\nexport function boom() { z.config(z.locales.ru()) }\n`,
      'src/guard-fixture.ts'
    )

    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-syntax')
    // The message has to name the offender, not just fail — a guard whose
    // output does not say what to do sends the reader back to the config.
    expect(messages[0]?.message).toMatch(/global Zod locale/i)
    expect(messages[0]?.message).toMatch(/useLocalizedForm/)
  })

  it('bans a global Zod locale in test files too', async () => {
    // The relaxation for tests is deliberate but partial: it drops the
    // non-ASCII selectors and must keep this one. That asymmetry is exactly
    // what went wrong before, so it is asserted rather than assumed.
    expect(
      await ruleIds(
        `import { z } from 'zod'\nz.config(z.locales.ru())\n`,
        'src/guard-fixture.test.ts'
      )
    ).toContain('no-restricted-syntax')
  })

  it('bans locale-unaware navigation imports', async () => {
    const messages = await lint(
      `import Link from 'next/link'\nexport const L = Link\n`,
      'src/guard-fixture.ts'
    )

    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports')
    expect(messages[0]?.message).toMatch(/@\/i18n\/navigation/)
  })

  it('bans locale-unaware navigation hooks', async () => {
    expect(
      await ruleIds(
        `import { useRouter } from 'next/navigation'\nexport const r = useRouter\n`,
        'src/guard-fixture.ts'
      )
    ).toContain('no-restricted-imports')
  })

  it('bans non-ASCII copy in application code', async () => {
    expect(await ruleIds(`export const t = 'Привет'\n`, 'src/guard-fixture.ts')).toContain(
      'no-restricted-syntax'
    )
  })

  it('bans non-ASCII copy in a template literal', async () => {
    expect(await ruleIds('export const t = `Привет`\n', 'src/guard-fixture.ts')).toContain(
      'no-restricted-syntax'
    )
  })

  it('allows non-ASCII fixture data in tests', async () => {
    // The exemption is the point of the narrower block; if it stops working,
    // every spec with Cyrillic input starts failing lint.
    expect(
      await ruleIds(`export const input = 'Привет'\n`, 'src/guard-fixture.test.ts')
    ).not.toContain('no-restricted-syntax')
  })

  it('leaves compliant code alone', async () => {
    expect(
      await ruleIds(
        `import { Link } from '@/i18n/navigation'\nexport const L = Link\n`,
        'src/guard-fixture.ts'
      )
    ).toHaveLength(0)
  })
})

describe('no guard can silently replace another', () => {
  // Two config blocks that set the same rule key for the same files do not add
  // up — the later one wins and the earlier entries disappear from the
  // effective config. A narrower block over a *subset* of files is a
  // legitimate, deliberate relaxation (asserted behaviourally above); an
  // identical file set is always an accident.
  //
  // Scoped to the two rule keys whose options are a list of independent entries
  // that different guards are meant to contribute to — those are the ones where
  // "replace, not merge" silently loses a rule. Deliberately NOT scoped by
  // block name: an earlier version of this test keyed on the `project/` prefix
  // and kept passing when the prefix was renamed, which is the same class of
  // false green it exists to catch.
  const LIST_VALUED_RULES = ['no-restricted-syntax', 'no-restricted-imports'] as const

  const scopesByRule = new Map<string, { scope: string; name: string }[]>()
  for (const block of config) {
    if (!block?.rules) continue
    const scope = JSON.stringify({ files: block.files ?? null, ignores: block.ignores ?? null })
    for (const ruleId of LIST_VALUED_RULES) {
      if (!(ruleId in block.rules)) continue
      scopesByRule.set(ruleId, [
        ...(scopesByRule.get(ruleId) ?? []),
        { scope, name: String(block.name ?? '(unnamed)') },
      ])
    }
  }

  it.each(LIST_VALUED_RULES)('actually finds %s in the config', (ruleId) => {
    // Non-vacuity: if a rule is renamed away or the config stops exporting an
    // array, the collision check below would pass while examining nothing.
    expect(scopesByRule.get(ruleId) ?? []).not.toHaveLength(0)
  })

  it.each(LIST_VALUED_RULES)('never configures %s twice for the same file set', (ruleId) => {
    const byScope = new Map<string, string[]>()
    for (const { scope, name } of scopesByRule.get(ruleId) ?? []) {
      byScope.set(scope, [...(byScope.get(scope) ?? []), name])
    }

    const collisions = [...byScope.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([scope, names]) => `${ruleId} configured by ${names.join(' and ')} over ${scope}`)

    expect(collisions).toEqual([])
  })
})
