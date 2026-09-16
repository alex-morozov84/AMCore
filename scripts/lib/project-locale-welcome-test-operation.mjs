import { absent, claim, localeParams, testCall } from './project-locale-ast-helpers.mjs'

const WORD = { en: 'Welcome', ru: 'Добро пожаловать' }

function baseTest(locale) {
  return `it('should render in the base (and only) supported locale by default', async () => {
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
    expect(html).toContain('${WORD[locale]}')
    expect(html).toContain('AMCore')

    // Check HTML structure
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
    expect(html).toContain('<body')
  })`
}

function welcomeTest(model, { locale }, ctx) {
  model.replaceNode(
    testCall(model, 'should render in the base locale (English) by default', ctx),
    baseTest(locale),
    ctx
  )
  model.removeNode(testCall(model, 'should render in Russian when locale=ru', ctx), ctx)
}

export function registerLocaleWelcomeTestOperation(registry) {
  registry.define('locale.welcome-email-test', {
    paramsSchema: localeParams,
    deriveSemanticWrites: ({ locale }) => [
      claim('ts:welcome-email-test:default-locale', locale),
      absent('ts:welcome-email-test:secondary-locale'),
    ],
    adapter: welcomeTest,
  })
}
