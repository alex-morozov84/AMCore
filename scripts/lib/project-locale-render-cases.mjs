const WORDS = {
  en: ['Welcome', 'Password Reset', 'Verify', 'invited'],
  ru: ['Добро пожаловать', 'Сброс пароля', 'Подтвердите', 'пригласил'],
}

export const RENDER_CASE_TYPE = `type RenderCase = {
  name: string
  namespace: string
  build: (locale?: Locale) => Parameters<typeof render>[0]
  expectedWord: string
}`

function welcomeCase(word) {
  return `  {
    name: 'welcome',
    namespace: 'welcome',
    build: (locale) => WelcomeEmail({ name: 'Иван', email: 'ivan@example.com', locale }),
    expectedWord: '${word}',
  }`
}

function resetCase(word) {
  return `  {
    name: 'password-reset',
    namespace: 'passwordReset',
    build: (locale) =>
      PasswordResetEmail({
        name: 'Иван',
        resetUrl: 'https://app.example.com/reset-password?token=abc',
        expiresInMinutes: 15,
        locale,
      }),
    expectedWord: '${word}',
  }`
}

function verificationCase(word) {
  return `  {
    name: 'email-verification',
    namespace: 'emailVerification',
    build: (locale) =>
      EmailVerificationEmail({
        name: 'Иван',
        verificationUrl: 'https://app.example.com/verify-email?token=xyz',
        expiresInHours: 48,
        locale,
      }),
    expectedWord: '${word}',
  }`
}

function inviteCase(word) {
  return `  {
    name: 'org-invite',
    namespace: 'orgInvite',
    build: (locale) =>
      OrgInviteEmail({
        orgName: 'Acme',
        inviterName: 'Alex',
        inviterEmail: 'alex@example.com',
        roleName: 'MEMBER',
        hasAccount: true,
        acceptUrl: 'https://app.example.com/invite/accept?token=abc',
        expiresInDays: 7,
        locale,
      }),
    expectedWord: '${word}',
  }`
}

export function renderCases(locale) {
  const [welcome, reset, verification, invite] = WORDS[locale]
  const cases = [
    welcomeCase(welcome),
    resetCase(reset),
    verificationCase(verification),
    inviteCase(invite),
  ]
  return `const cases: RenderCase[] = [\n${cases.join(',\n')},\n]`
}

export const renderLocaleIds = (locale) => `const localeIds = (namespace: string): string[] =>
  Object.keys(emailMessages.${locale}).filter((id) => id.startsWith(\`\${namespace}.\`))`

export const renderWord = (locale) => WORDS[locale][0]
export const otherRenderWord = (locale) => WORDS[locale === 'en' ? 'ru' : 'en'][0]
