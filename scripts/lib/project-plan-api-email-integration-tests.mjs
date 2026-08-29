// init:project --mode=single: email-verification/org-invite/password-reset
// integration specs. Found via the real `pnpm --filter api test` in
// init-project.test.mjs — each has a dedicated "render in Russian" test and
// a subject-comparison test proving the two locales differ; both assume a
// second locale exists. Targeted removal/patch, not a whole-file rewrite:
// the surrounding HTML-structure/security-warning tests are unrelated.
import path from 'node:path'
import { fileStep, removeExactBlock, replaceExactBlock } from './init-engine.mjs'

const EMAIL_VERIFICATION_RUSSIAN_TEST = `  it('should render in Russian when locale=ru', async () => {
    const html = await render(EmailVerificationEmail({ ...baseProps, locale: 'ru' }))

    expect(html).toContain('Подтвердите ваш email')
    expect(html).toContain('Подтвердить email')
    expect(html).not.toContain('Verify your email')
    expect(html).toContain(baseProps.verificationUrl)
  })

`

const EMAIL_VERIFICATION_SUBJECT_TEST_BEFORE = `  it('getEmailVerificationSubject returns a localized, non-empty subject', () => {
    expect(getEmailVerificationSubject('ru')).toBeTruthy()
    expect(getEmailVerificationSubject('en')).toBeTruthy()
    expect(getEmailVerificationSubject('ru')).not.toBe(getEmailVerificationSubject('en'))
  })
`

const ORG_INVITE_RUSSIAN_TEST = `  it('should render in Russian when locale=ru', async () => {
    const html = await render(OrgInviteEmail({ ...baseProps, hasAccount: true, locale: 'ru' }))

    expect(html).toContain('Войти и принять приглашение')
    expect(html).not.toContain('Sign in to accept the invitation')
    expect(html).toContain('https://app.example.com/invite/accept?token=raw-token-123')
  })

`

const ORG_INVITE_SUBJECT_TEST_BEFORE = `  it('should localize the subject with the org name', () => {
    expect(getOrgInviteSubject('Acme Inc.', 'ru')).toContain('Acme Inc.')
    expect(getOrgInviteSubject('Acme Inc.', 'en')).toBe('Invitation to join Acme Inc.')
  })
`

const PASSWORD_RESET_RUSSIAN_TEST = `  it('should render in Russian when locale=ru', async () => {
    const html = await render(PasswordResetEmail({ ...baseProps, locale: 'ru' }))

    expect(html).toContain('Сброс пароля')
    expect(html).toContain(baseProps.resetUrl)
  })

`

const PASSWORD_RESET_SUBJECT_TEST_BEFORE = `  it('getPasswordResetSubject returns a localized, non-empty subject', () => {
    expect(getPasswordResetSubject('ru')).toBeTruthy()
    expect(getPasswordResetSubject('en')).toBeTruthy()
    expect(getPasswordResetSubject('ru')).not.toBe(getPasswordResetSubject('en'))
  })
`

export function buildApiEmailIntegrationTestsSteps(root, locale) {
  return [
    fileStep(
      path.join(
        root,
        'apps/api/src/infrastructure/email/templates/email-verification.integration.spec.ts'
      ),
      (content) => {
        const next = removeExactBlock(content, EMAIL_VERIFICATION_RUSSIAN_TEST)
        return replaceExactBlock(
          next,
          EMAIL_VERIFICATION_SUBJECT_TEST_BEFORE,
          `  it('getEmailVerificationSubject returns a non-empty subject', () => {\n` +
            `    expect(getEmailVerificationSubject('${locale}')).toBeTruthy()\n  })\n`
        )
      },
      'email-verification.integration.spec.ts: test only the kept locale'
    ),
    fileStep(
      path.join(root, 'apps/api/src/infrastructure/email/templates/org-invite.integration.spec.ts'),
      (content) => {
        const next = removeExactBlock(content, ORG_INVITE_RUSSIAN_TEST)
        return replaceExactBlock(
          next,
          ORG_INVITE_SUBJECT_TEST_BEFORE,
          `  it('should localize the subject with the org name', () => {\n` +
            `    expect(getOrgInviteSubject('Acme Inc.', '${locale}')).toContain('Acme Inc.')\n  })\n`
        )
      },
      'org-invite.integration.spec.ts: test only the kept locale'
    ),
    fileStep(
      path.join(
        root,
        'apps/api/src/infrastructure/email/templates/password-reset.integration.spec.ts'
      ),
      (content) => {
        const next = removeExactBlock(content, PASSWORD_RESET_RUSSIAN_TEST)
        return replaceExactBlock(
          next,
          PASSWORD_RESET_SUBJECT_TEST_BEFORE,
          `  it('getPasswordResetSubject returns a non-empty subject', () => {\n` +
            `    expect(getPasswordResetSubject('${locale}')).toBeTruthy()\n  })\n`
        )
      },
      'password-reset.integration.spec.ts: test only the kept locale'
    ),
  ]
}
