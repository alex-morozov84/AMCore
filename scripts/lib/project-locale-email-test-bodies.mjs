export const EMAIL_TEST_BODIES = Object.freeze({
  verification: `it('should render in the base (and only) supported locale by default', async () => {
    const html = await render(EmailVerificationEmail(baseProps))

    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    expect(html).toContain('Alexander')
    expect(html).toContain('24 часа')

    // Assert the translated chrome, not just the interpolated props.
    expect(html).toContain('Подтвердите ваш email')
    expect(html).toContain('Подтвердить email')
    expect(html).not.toContain('Verify your email')

    // The raw verification token must reach the recipient via the button href.
    expect(html).toContain('https://app.example.com/verify-email?token=raw-token-xyz')

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })`,
  inviteSignIn: `it('should render in the base (and only) supported locale by default with the sign-in CTA', async () => {
    const html = await render(OrgInviteEmail({ ...baseProps, hasAccount: true }))

    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    // Localized content and interpolated props.
    expect(html).toContain('Acme Inc.')
    expect(html).toContain('alex@example.com')
    expect(html).toContain('MEMBER')
    expect(html).toContain('Войти и принять приглашение')

    // The raw accept token must reach the recipient via the button href.
    expect(html).toContain('https://app.example.com/invite/accept?token=raw-token-123')

    // HTML structure
    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })`,
  inviteSignUp: `it('should render the sign-up CTA when the recipient has no account', async () => {
    const html = await render(OrgInviteEmail({ ...baseProps, hasAccount: false }))

    expect(html).toContain('Создать аккаунт и присоединиться')
    expect(html).not.toContain('Войти и принять приглашение')
  })`,
  reset: `it('should render in the base (and only) supported locale by default', async () => {
    const html = await render(PasswordResetEmail(baseProps))

    expect(html).toBeTruthy()
    expect(typeof html).toBe('string')

    expect(html).toContain('Alexander')
    expect(html).toContain('Сброс пароля')
    expect(html).toContain('60 минут')

    // The raw reset token must reach the recipient via the button href.
    expect(html).toContain('https://app.example.com/reset-password?token=raw-token-abc')

    expect(html).toContain('<!DOCTYPE html')
    expect(html).toContain('</html>')
  })`,
})
