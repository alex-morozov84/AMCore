// CSS-side half of the token-only styling guards.
//
// Same obligation as `eslint-guards.test.ts`: the tree has no CSS Modules yet,
// so these fixtures are the only evidence the policy works. Half of them are
// permissiveness cases — a colour rule that also rejected `border: 1px solid
// var(--border)` would be switched off rather than obeyed, and an earlier
// candidate plugin did exactly that.

import path from 'node:path'

import stylelint from 'stylelint'
import { describe, expect, it } from 'vitest'

const WEB_ROOT = path.resolve(import.meta.dirname, '../..')

/** Rule names reported for `css`, linted as the given file. */
async function ruleNames(css: string, filePath: string) {
  const { results } = await stylelint.lint({
    code: css,
    codeFilename: path.join(WEB_ROOT, filePath),
    configFile: path.join(WEB_ROOT, 'stylelint.config.mjs'),
  })

  return results[0].warnings.map((w) => w.rule)
}

const TOKEN_RULES = ['color-no-hex', 'color-named', 'declaration-property-value-disallowed-list']

describe('CSS Modules may not reach past the design tokens', () => {
  it.each([
    ['a hex colour', '.a { color: #333; }'],
    ['a named colour', '.a { background: red; }'],
    ['rgb()', '.a { border-color: rgb(0 0 0); }'],
    ['hsl()', '.a { outline-color: hsl(0 0% 0%); }'],
    ['lab()', '.a { fill: lab(50% 40 59); }'],
    ['lch()', '.a { stroke: lch(50% 40 30deg); }'],
    // Colours hidden inside a shorthand are the case that defeated the
    // property-keyed plugin evaluated for this: it cannot see the colour past
    // the width, and demanding a token for `1px` is worse than not checking.
    ['a named colour inside a shorthand', '.a { border: 1px solid red; }'],
    ['a colour function inside a shorthand', '.a { box-shadow: 0 1px 2px oklch(0.5 0.2 30deg); }'],
    ['raw channels inside color-mix()', '.a { color: color-mix(in oklch, red, blue); }'],
    // `color()` was missed on the first pass: it was left out of the ban to
    // avoid colliding with `color-mix(`, a collision that cannot happen because
    // the pattern requires the name to be followed immediately by `(`.
    ['color()', '.a { color: color(display-p3 1 0 0); }'],
    [
      'color() nested inside a color-mix()',
      '.a { color: color-mix(in oklch, var(--a), color(display-p3 1 0 0)); }',
    ],
  ])('rejects %s', async (_name, css) => {
    const rules = await ruleNames(css, 'src/probe.module.css')

    expect(rules.some((rule) => TOKEN_RULES.includes(String(rule)))).toBe(true)
  })

  it.each([
    ['a token reference', '.a { color: var(--foreground); }'],
    ['a token inside a shorthand', '.a { border: 1px solid var(--border); }'],
    ['a token inside a box-shadow', '.a { box-shadow: 0 1px 2px var(--shadow); }'],
    ['currentcolor', '.a { color: currentcolor; }'],
    ['transparent', '.a { background: transparent; }'],
    ['none', '.a { fill: none; }'],
    // A background image is not a colour decision.
    ['url()', '.a { background: url("/hero.png") no-repeat; }'],
    // Composing two tokens stays legal. Only raw channels are rejected — the
    // regex needs a `(^|[\s,(])` prefix or the bare word `oklch` here matches.
    ['color-mix() of two tokens', '.a { color: color-mix(in oklch, var(--a), var(--b)); }'],
  ])('allows %s', async (_name, css) => {
    expect(await ruleNames(css, 'src/probe.module.css')).toEqual([])
  })

  it('names the token system in the message, not just the ban', async () => {
    const { results } = await stylelint.lint({
      code: '.a { color: #333; }',
      codeFilename: path.join(WEB_ROOT, 'src/probe.module.css'),
      configFile: path.join(WEB_ROOT, 'stylelint.config.mjs'),
    })

    expect(results[0].warnings.map((w) => w.text).join(' ')).toMatch(/hex color/i)
  })
})

describe('CSS Module class names follow the convention they are read by', () => {
  it('accepts camelCase', async () => {
    expect(await ruleNames('.chartGrid { color: var(--fg); }', 'src/probe.module.css')).toEqual([])
  })

  it('rejects kebab-case, which would force styles["chart-grid"]', async () => {
    expect(await ruleNames('.chart-grid { color: var(--fg); }', 'src/probe.module.css')).toContain(
      'selector-class-pattern'
    )
  })
})

describe('the token policy is scoped, not global', () => {
  // `globals.css` is where the tokens are declared, so raw colour is correct
  // there. If the override ever widened to every stylesheet, the theme file
  // itself would start failing — this is the assertion that says so.
  it('permits raw colour where the tokens are defined', async () => {
    expect(await ruleNames(':root { --card: #fff; }', 'src/app/globals.css')).toEqual([])
  })

  it('still validates Tailwind at-rules rather than skipping the file', async () => {
    expect(await ruleNames('@nonsense-rule { color: red; }', 'src/app/globals.css')).toContain(
      'at-rule-no-unknown'
    )
  })

  it('accepts the Tailwind directives the theme actually uses', async () => {
    const css = [
      "@import 'tailwindcss';",
      '',
      '@custom-variant dark (&:where(.dark, .dark *));',
      '',
      '@theme inline {',
      '  --color-card: var(--card);',
      '}',
      '',
    ].join('\n')

    expect(await ruleNames(css, 'src/app/globals.css')).toEqual([])
  })
})
