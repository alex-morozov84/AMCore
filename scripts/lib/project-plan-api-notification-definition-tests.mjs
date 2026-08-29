// init:project --mode=single: account-password-changed.definition.spec.ts and
// notification-definition.registry.spec.ts. Found via the real `pnpm
// --filter api test` in init-project.test.mjs — both render the same
// notification in both locales to prove the translation differs, which has
// nothing left to compare once only one locale exists. Drop the other
// locale's assertions; the kept locale's rendering is still proven.
import path from 'node:path'
import { fileStep, replaceExactBlock } from './init-engine.mjs'

const RENDER_EMAIL_BEFORE = `  it('renders detailed email copy from the projection in both locales', () => {
    const en = def.renderEmail!({ changedAt }, 'en')
    expect(en.title).toBe('Your password was changed')
    expect(en.body).toContain('successfully changed')

    const ru = def.renderEmail!({ changedAt }, 'ru')
    expect(ru.title).toBe('Ваш пароль был изменён')
    expect(ru.body).toContain('успешно изменён')
  })
`

const RENDER_IN_APP_BEFORE = `  it('renders a neutral in-app title/body without exposing the payload', () => {
    expect(def.renderInApp({ changedAt }, 'en').title).toBe('Password changed')
    expect(def.renderInApp({ changedAt }, 'ru').title).toBe('Пароль изменён')
  })
`

const EMAIL_COPY = {
  en: { title: 'Your password was changed', body: 'successfully changed' },
  ru: { title: 'Ваш пароль был изменён', body: 'успешно изменён' },
}
const IN_APP_TITLE = { en: 'Password changed', ru: 'Пароль изменён' }

function accountPasswordChangedTransform(locale) {
  const email = EMAIL_COPY[locale]
  return (content) => {
    const next = replaceExactBlock(
      content,
      RENDER_EMAIL_BEFORE,
      `  it('renders detailed email copy from the projection', () => {\n` +
        `    const rendered = def.renderEmail!({ changedAt }, '${locale}')\n` +
        `    expect(rendered.title).toBe('${email.title}')\n` +
        `    expect(rendered.body).toContain('${email.body}')\n` +
        `  })\n`
    )
    return replaceExactBlock(
      next,
      RENDER_IN_APP_BEFORE,
      `  it('renders a neutral in-app title/body without exposing the payload', () => {\n` +
        `    expect(def.renderInApp({ changedAt }, '${locale}').title).toBe('${IN_APP_TITLE[locale]}')\n` +
        `  })\n`
    )
  }
}

const REGISTRY_RENDER_BEFORE = `      expect(def.renderInApp({ updatedFields: ['name'] }, 'en').title).toBe('Profile updated')
      expect(def.renderInApp({ updatedFields: ['name'] }, 'ru').title).toBe('Профиль обновлён')
`

const PROFILE_TITLE = { en: 'Profile updated', ru: 'Профиль обновлён' }

function registryTransform(locale) {
  return (content) =>
    replaceExactBlock(
      content,
      REGISTRY_RENDER_BEFORE,
      `      expect(def.renderInApp({ updatedFields: ['name'] }, '${locale}').title).toBe(` +
        `'${PROFILE_TITLE[locale]}')\n`
    )
}

export function buildApiNotificationDefinitionTestSteps(root, locale) {
  return [
    fileStep(
      path.join(
        root,
        'apps/api/src/core/notifications/definitions/account-password-changed.definition.spec.ts'
      ),
      accountPasswordChangedTransform(locale),
      `account-password-changed.definition.spec.ts: render only the '${locale}' copy`
    ),
    fileStep(
      path.join(root, 'apps/api/src/core/notifications/notification-definition.registry.spec.ts'),
      registryTransform(locale),
      `notification-definition.registry.spec.ts: render only the '${locale}' copy`
    ),
  ]
}
