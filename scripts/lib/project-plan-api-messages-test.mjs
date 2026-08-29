// init:project --mode=single: apps/api/src/infrastructure/email/messages.spec.ts.
// Found via the real `pnpm --filter api test` in init-project.test.mjs — this
// is the apps/api analog of apps/web's messages.test.ts (see
// project-plan-web-messages-test.mjs): a parity guard comparing the ru/en
// message maps, which crashes outright once emailMessages has only one key
// (project-plan-shared.mjs's buildSharedLocaleSteps trims it). Whole-file
// exactContentStep: the parity comparison has nothing left to compare
// against, so most of the file changes to testing completeness instead.
import path from 'node:path'
import { exactContentStep } from './init-engine.mjs'

const BEFORE = `import { emailMessages } from './messages'

/**
 * i18n parity guard (EQS-08).
 *
 * FormatJS renders a missing message id as the literal id string (non-fatal, by
 * design — see the render-robustness integration test). The real risk is a key
 * that exists in one locale but not the other: it would silently ship an
 * untranslated \`someKey.id\` in the missing locale. This test enforces that both
 * locales expose exactly the same set of message ids.
 */
describe('emailMessages i18n parity', () => {
  const ruKeys = Object.keys(emailMessages.ru).sort()
  const enKeys = Object.keys(emailMessages.en).sort()

  it('ru and en define exactly the same message ids', () => {
    expect(ruKeys).toEqual(enKeys)
  })

  it('has no empty message values in either locale', () => {
    const empties: string[] = []
    for (const [locale, messages] of Object.entries(emailMessages)) {
      for (const [id, value] of Object.entries(messages)) {
        if (typeof value !== 'string' || value.trim() === '') empties.push(\`\${locale}.\${id}\`)
      }
    }
    expect(empties).toEqual([])
  })

  /**
   * CLDR plural categories each locale must supply whenever a message uses an
   * ICU \`plural\` argument. Russian needs \`few\` and \`many\`; supplying only
   * \`one\`/\`other\` still renders — with the wrong grammar for counts like 2 or
   * 5 — and stays invisible while testing in English. That silent-but-wrong
   * failure mode is why this is a test rather than a review note.
   */
  const REQUIRED_PLURAL_CATEGORIES: Record<string, string[]> = {
    en: ['one', 'other'],
    ru: ['one', 'few', 'many', 'other'],
  }

  it('supplies every required plural category in each locale', () => {
    const offenders: string[] = []

    for (const [locale, messages] of Object.entries(emailMessages)) {
      const required = REQUIRED_PLURAL_CATEGORIES[locale]
      // Jest's expect takes no message argument; assert the lookup separately.
      if (!required) throw new Error(\`no plural categories declared for locale \${locale}\`)

      for (const [id, value] of Object.entries(messages)) {
        if (!/\\{[^}]*,\\s*plural\\s*,/.test(value)) continue
        for (const category of required!) {
          if (!new RegExp(\`\\\\b\${category}\\\\s*\\\\{\`).test(value)) {
            offenders.push(\`\${locale}.\${id} is missing "\${category}"\`)
          }
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('actually has pluralized messages to check', () => {
    // Guards the guard: the check above passes vacuously if no message uses a
    // plural, which would hide a regression that stripped them.
    const pluralized = Object.values(emailMessages.ru).filter((value) =>
      /\\{[^}]*,\\s*plural\\s*,/.test(value)
    )
    expect(pluralized.length).toBeGreaterThanOrEqual(3)
  })
})
`

const REQUIRED_PLURAL_CATEGORIES = {
  en: ['one', 'other'],
  ru: ['one', 'few', 'many', 'other'],
}

function after(locale) {
  const categoriesLiteral = REQUIRED_PLURAL_CATEGORIES[locale].map((c) => `'${c}'`).join(', ')

  return `import { emailMessages } from './messages'

/**
 * i18n completeness guard (EQS-08).
 *
 * FormatJS renders a missing message id as the literal id string (non-fatal, by
 * design — see the render-robustness integration test). With only one
 * supported locale left, there is nothing to compare it against for parity —
 * this proves the one catalogue is actually complete instead.
 */
describe('emailMessages i18n completeness', () => {
  const messages = emailMessages.${locale}

  it('has no empty message values', () => {
    const empties = Object.entries(messages)
      .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
      .map(([id]) => id)
    expect(empties).toEqual([])
  })

  /**
   * CLDR plural categories the one supported locale must supply whenever a
   * message uses an ICU \`plural\` argument.
   */
  const REQUIRED_PLURAL_CATEGORIES = [${categoriesLiteral}]

  it('supplies every required plural category', () => {
    const offenders: string[] = []

    for (const [id, value] of Object.entries(messages)) {
      if (!/\\{[^}]*,\\s*plural\\s*,/.test(value)) continue
      for (const category of REQUIRED_PLURAL_CATEGORIES) {
        if (!new RegExp(\`\\\\b\${category}\\\\s*\\\\{\`).test(value)) {
          offenders.push(\`\${id} is missing "\${category}"\`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('actually has pluralized messages to check', () => {
    // Guards the guard: the check above passes vacuously if no message uses a
    // plural, which would hide a regression that stripped them.
    const pluralized = Object.values(messages).filter((value) =>
      /\\{[^}]*,\\s*plural\\s*,/.test(value)
    )
    expect(pluralized.length).toBeGreaterThanOrEqual(3)
  })
})
`
}

export function buildApiMessagesTestSteps(root, locale) {
  return [
    exactContentStep(
      path.join(root, 'apps/api/src/infrastructure/email/messages.spec.ts'),
      { expectedBefore: BEFORE, after: after(locale) },
      'messages.spec.ts: test the one remaining catalogue for completeness, drop the parity comparison'
    ),
  ]
}
