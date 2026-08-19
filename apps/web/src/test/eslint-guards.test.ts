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

import { spawnSync } from 'node:child_process'
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

describe('FSD boundaries', () => {
  // Layer direction and slice public API, both from `boundaries/dependencies`.
  // Each case was proven by hand against this config before being written down.
  //
  // The cross-slice case is the one that matters most: allowing
  // `features -> features` so a group barrel can reach its own slices also
  // permits any slice to reach any other, and that version of the config passed
  // every other case here while not guarding. No feature slice is grouped
  // today (Track 9 flattened `auth`/`sessions`, the only two), but the
  // `sameGroup` mechanism stays in the policy for `pages` and a future
  // feature group, so this case stays asserted rather than deleted.
  it.each([
    ['shared may not import features', 'src/shared/lib/probe.ts', "'@/features/auth-login'", true],
    [
      'features may import entities',
      'src/features/auth-login/probe.ts',
      "'@/entities/user'",
      false,
    ],
    ['features may import shared', 'src/features/auth-login/probe.ts', "'@/shared/lib'", false],
    [
      'a slice may not be entered past its public API',
      'src/_pages/auth/probe.ts',
      "'@/features/auth-login/ui/LoginForm'",
      true,
    ],
    [
      'a slice may not import a sibling feature slice',
      'src/features/auth-login/probe.ts',
      "'@/features/locale-switcher'",
      true,
    ],
    ['a shared segment barrel is fine', 'src/_pages/auth/probe.ts', "'@/shared/lib'", false],
    ['a shared module import is fine', 'src/_pages/auth/probe.ts', "'@/shared/ui/button'", false],
  ])('%s', async (_name, filePath, source, shouldReport) => {
    const ids = await ruleIds(`import * as x from ${source}\nexport const y = x\n`, filePath)
    if (shouldReport) {
      expect(ids).toContain('boundaries/dependencies')
    } else {
      expect(ids).toEqual([])
    }
  })

  // `boundaries` cannot see a layer-level barrel — `src/features/index.ts` is
  // inside no element — so this one is the `no-restricted-imports` pattern, and
  // it is asserted here so the split of responsibility cannot rot unnoticed.
  it('bans layer-level barrels via the import pattern, not the plugin', async () => {
    const messages = await lint(
      `import * as x from '@/features'\nexport const y = x\n`,
      'src/_pages/auth/probe.ts'
    )

    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports')
    expect(messages[0]?.message).toMatch(/No layer-level barrels/)
  })

  it('still bans layer barrels inside the navigation source file', async () => {
    // `src/i18n/navigation.ts` is exempted from the navigation ban over a strict
    // subset of files. That block restates the layer-barrel pattern; if someone
    // drops it, the exemption silently widens.
    expect(
      await ruleIds(
        `import * as x from '@/features'\nexport const y = x\n`,
        'src/i18n/navigation.ts'
      )
    ).toContain('no-restricted-imports')
  })

  // The config must not rely on a deprecated plugin API. Run in a child process
  // on purpose: the plugin warns through `console` once per process, so an
  // in-process assertion would pass simply because an earlier test consumed it.
  // Generous timeout on purpose: this spawns a full ESLint run over `src`, which
  // takes ~1.5 s locally and ~7.5 s on CI. Vitest's 5 s default killed it on the
  // first CI run. Narrowing the target would be faster but reintroduces the
  // "no imports, so the plugin never warns" false green this check exists to
  // avoid, so the run stays wide and the budget is stated instead.
  it('uses no deprecated boundaries API', () => {
    const run = spawnSync(
      'node',
      // The whole tree on purpose. The plugin only warns once it actually
      // resolves a dependency, so a file with no imports reports nothing --
      // an earlier version of this test linted `manifest.ts` and passed with a
      // deprecated rule reintroduced. Linting `src` also survived the `views`
      // -> `_pages` rename (Track 9), which a narrower path would not have.
      [path.join(WEB_ROOT, 'node_modules/eslint/bin/eslint.js'), 'src'],
      { cwd: WEB_ROOT, encoding: 'utf8' }
    )

    // stdout AND stderr: the plugin warns through `console.warn`, which is
    // stderr. An earlier version of this assertion read stdout only and passed
    // happily with a deprecated rule reintroduced.
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`

    expect(output).not.toMatch(/\[boundaries]\[warning]/)
    expect(output).not.toMatch(/deprecated/i)
  }, 60_000)
})

describe('token-only styling', () => {
  // The palette is the source for tokens; components consume tokens only.
  // Two ways past them are reachable from code, and both are banned. Half of
  // these fixtures are permissiveness cases: a colour rule that also rejected
  // `w-[32px]` or `text-chart-1` would be turned off rather than obeyed.
  it.each([
    ['a default-palette utility', `<div className="bg-red-500" />`, true],
    // Variant prefixes are the likeliest real-world form and were missed by the
    // first anchor this rule used.
    [
      'a palette utility behind variants',
      `<div className="hover:bg-red-500 dark:text-gray-800" />`,
      true,
    ],
    ['a palette utility behind a breakpoint', `<div className="sm:border-blue-300" />`, true],
    ['stacked variants', `<div className="dark:md:hover:bg-fuchsia-600" />`, true],
    ['a group variant', `<div className="group-hover:text-rose-600" />`, true],
    ['an arbitrary variant', `<div className="[&>*]:text-slate-500" />`, true],
    // Derived from the installed Tailwind: `mauve` did not exist when a
    // hand-written hue list was tried, and slipped straight through it.
    ['a hue that a hand-written list would have missed', `<div className="bg-mauve-500" />`, true],
    ['a raw hex in an arbitrary value', `<div className="bg-[#8b5cf6]" />`, true],
    ['a raw oklch() in an arbitrary value', `<div className="ring-[oklch(.5_.2_30)]" />`, true],
    ['semantic tokens', `<div className="bg-destructive text-muted-foreground" />`, false],
    // `chart-1` ends in a number but has no palette scale -- the shape that
    // separates a token from `bg-red-500`.
    ['a numbered token', `<div className="text-chart-1" />`, false],
    ['a token whose name resembles a palette class', `<div className="bg-brand-primary" />`, false],
    ['a numeric spacing utility', `<div className="gap-x-100" />`, false],
    [
      'layout utilities and arbitraries',
      `<div className="w-[32px] grid-cols-[1fr_auto] max-w-md" />`,
      false,
    ],
    ['a CSS variable in an arbitrary value', `<div className="bg-[var(--brand)]" />`, false],
    // Known guard limitation, asserted so nobody mistakes it for coverage:
    // palette-scale colours are banned, but scale-less white/black still need
    // review. `text-white` is no longer needed by the destructive button after
    // Track 5's `--destructive-foreground` token fix.
    ['scale-less white', `<div className="text-white" />`, false],
  ])('%s', async (_name, jsx, shouldReport) => {
    const ids = await ruleIds(`export const P = () => ${jsx}\n`, 'src/probe.tsx')

    if (shouldReport) {
      expect(ids).toContain('no-restricted-syntax')
    } else {
      expect(ids).toEqual([])
    }
  })

  it('catches a raw colour in a class string outside JSX', async () => {
    // `cva()` variant objects are plain strings, and are the likeliest place a
    // brand colour gets pasted -- a JSX-only rule would have looked thorough
    // while missing them.
    expect(
      await ruleIds(`export const v = { primary: 'bg-[rgb(139,92,246)]' }\n`, 'src/probe.ts')
    ).toContain('no-restricted-syntax')
  })

  it('bans the inline style prop outright, via a maintained rule', async () => {
    // Not a bespoke selector: allowing "only non-colour" inline styles required
    // a hand-maintained list of CSS colour properties, which is the fragile
    // shape this track exists to remove.
    const messages = await lint(
      `export const P = () => <div style={{ width: '32px' }} />\n`,
      'src/probe.tsx'
    )

    expect(messages.map((m) => m.ruleId)).toContain('react/forbid-dom-props')
    expect(messages[0]?.message).toMatch(/token utilities/)
  })

  it('rejects even a non-colour inline style, on purpose', async () => {
    // The ban is deliberately wider than colour. A dynamic transform is a real
    // use, and it is meant to cost one `eslint-disable` with a reason rather
    // than be waved through by a rule guessing at intent.
    expect(
      await ruleIds(
        `export const P = () => <div style={{ transform: 'translateX(1px)' }} />\n`,
        'src/probe.tsx'
      )
    ).toContain('react/forbid-dom-props')
  })

  it('leaves a custom component prop named style alone', async () => {
    // The ban is about the DOM prop. A component that happens to take `style`
    // is not a theme violation, and reporting it would make the rule wrong.
    const code =
      `const Foo = (_: { style: object }) => null\n` +
      `export const P = () => <Foo style={{ width: '32px' }} />\n`

    expect(await ruleIds(code, 'src/probe.tsx')).toEqual([])
  })
})
