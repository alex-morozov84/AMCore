// init:project --mode=single: welcome.integration.spec.ts. Found via the
// real `pnpm --filter api test` in init-project.test.mjs — its first test
// already calls WelcomeEmail with no explicit locale (the template defaults
// to DEFAULT_LOCALE, so this keeps working for any chosen locale), but its
// assertions hardcode the English rendering. The dedicated "render in
// Russian" test is dropped: once the first test covers the kept locale by
// default, a second locale-specific test has nothing left to prove.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const BASE_LOCALE_TEST_BEFORE = `  it('should render in the base locale (English) by default', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Alexander Morozov',
        email: 'alex@example.com',
      })
    )

    // Check that HTML is generated
    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    // Check English content
    expect(html).toContain('Alexander Morozov')
    expect(html).toContain('alex@example.com')
    expect(html).toContain('Welcome')
    expect(html).toContain('AMCore')

    // Check HTML structure
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('<body')
  })

  it('should render in Russian when locale=ru', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Александр Морозов',
        email: 'alex@example.com',
        locale: 'ru',
      })
    )

    // Check Russian content
    expect(html).toContain('Александр Морозов')
    expect(html).toContain('Добро пожаловать')
    expect(html).not.toContain('Thank you for signing up')
  })
`

const WELCOME_WORD = { en: 'Welcome', ru: 'Добро пожаловать' }

function after(locale) {
  return `  it('should render in the base (and only) supported locale by default', async () => {
    const html = await render(
      WelcomeEmail({
        name: 'Alexander Morozov',
        email: 'alex@example.com',
      })
    )

    // Check that HTML is generated
    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    // Check localized content
    expect(html).toContain('Alexander Morozov')
    expect(html).toContain('alex@example.com')
    expect(html).toContain('${WELCOME_WORD[locale]}')
    expect(html).toContain('AMCore')

    // Check HTML structure
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('<body')
  })
`
}

export function buildApiWelcomeIntegrationTestSteps(root, locale) {
  return [
    fileStep(
      path.join(root, 'apps/api/src/infrastructure/email/templates/welcome.integration.spec.ts'),
      (content) => replaceExactBlock(content, BASE_LOCALE_TEST_BEFORE, after(locale)),
      'welcome.integration.spec.ts: render only the base (kept) locale by default'
    ),
  ]
}
