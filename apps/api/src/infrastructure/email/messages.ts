/**
 * Email Internationalization Messages
 *
 * Uses ICU Message Format for internationalization of email templates.
 * Supports variable interpolation, pluralization, and formatting.
 *
 * @see https://formatjs.io/docs/core-concepts/icu-syntax
 * @see https://react.email/docs/guides/internationalization/react-intl
 */

export type Locale = 'ru' | 'en'

export const emailMessages = {
  ru: {
    // Welcome Email
    'welcome.subject': 'Добро пожаловать в AMCore!',
    'welcome.preview': 'Добро пожаловать в AMCore!',
    'welcome.title': '👋 Добро пожаловать, {name}!',
    'welcome.intro':
      'Спасибо за регистрацию в AMCore — вашей персональной платформе для управления фитнесом, финансами и подписками.',
    'welcome.emailLabel': 'Email',
    'welcome.footer': 'С уважением, команда AMCore',

    // Password Reset Email
    'passwordReset.subject': 'Сброс пароля AMCore',
    'passwordReset.preview': 'Сброс пароля для вашего аккаунта',
    'passwordReset.title': 'Сброс пароля',
    'passwordReset.greeting': 'Привет, {name}!',
    'passwordReset.intro': 'Мы получили запрос на сброс пароля для вашего аккаунта.',
    'passwordReset.buttonText': 'Сбросить пароль',
    'passwordReset.expiresInfo': 'Эта ссылка действительна в течение {expiresIn}.',
    'passwordReset.ignoreInfo': 'Если вы не запрашивали сброс пароля, проигнорируйте это письмо.',
    'passwordReset.footer': 'С уважением, команда AMCore',

    // Email Verification
    'emailVerification.subject': 'Подтвердите ваш email',
    'emailVerification.preview': 'Подтвердите ваш email для активации аккаунта',
    'emailVerification.title': 'Подтвердите ваш email',
    'emailVerification.greeting': 'Привет, {name}!',
    'emailVerification.intro':
      'Спасибо за регистрацию! Подтвердите ваш email для активации аккаунта.',
    'emailVerification.buttonText': 'Подтвердить email',
    'emailVerification.expiresInfo': 'Эта ссылка действительна в течение {expiresIn}.',
    'emailVerification.ignoreInfo':
      'Если вы не регистрировались на AMCore, проигнорируйте это письмо.',
    'emailVerification.footer': 'С уважением, команда AMCore',
  },
  en: {
    // Welcome Email
    'welcome.subject': 'Welcome to AMCore!',
    'welcome.preview': 'Welcome to AMCore!',
    'welcome.title': '👋 Welcome, {name}!',
    'welcome.intro':
      'Thank you for signing up for AMCore — your personal platform for managing fitness, finances, and subscriptions.',
    'welcome.emailLabel': 'Email',
    'welcome.footer': 'Best regards, AMCore team',

    // Password Reset Email
    'passwordReset.subject': 'AMCore Password Reset',
    'passwordReset.preview': 'Reset password for your account',
    'passwordReset.title': 'Password Reset',
    'passwordReset.greeting': 'Hi, {name}!',
    'passwordReset.intro': 'We received a request to reset the password for your account.',
    'passwordReset.buttonText': 'Reset Password',
    'passwordReset.expiresInfo': 'This link is valid for {expiresIn}.',
    'passwordReset.ignoreInfo':
      'If you did not request a password reset, please ignore this email.',
    'passwordReset.footer': 'Best regards, AMCore team',

    // Email Verification
    'emailVerification.subject': 'Verify your email',
    'emailVerification.preview': 'Verify your email to activate your account',
    'emailVerification.title': 'Verify your email',
    'emailVerification.greeting': 'Hi, {name}!',
    'emailVerification.intro':
      'Thank you for signing up! Please verify your email to activate your account.',
    'emailVerification.buttonText': 'Verify Email',
    'emailVerification.expiresInfo': 'This link is valid for {expiresIn}.',
    'emailVerification.ignoreInfo': 'If you did not sign up for AMCore, please ignore this email.',
    'emailVerification.footer': 'Best regards, AMCore team',
  },
} as const
