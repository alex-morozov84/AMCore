/**
 * Email Internationalization Messages
 *
 * Uses ICU Message Format for internationalization of email templates.
 * Supports variable interpolation, pluralization, and formatting.
 *
 * @see https://formatjs.io/docs/core-concepts/icu-syntax
 * @see https://react.email/docs/guides/internationalization/react-intl
 */

import type { SupportedLocale } from '@amcore/shared'

// Email rendering reuses the single shared locale set so a new locale only has
// to be added in `SUPPORTED_LOCALES` (plus its message block below).
export type Locale = SupportedLocale

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

    // Password Changed Notification
    'passwordChanged.subject': 'Ваш пароль был изменен',
    'passwordChanged.preview': 'Ваш пароль был успешно изменен',
    'passwordChanged.title': 'Пароль изменен',
    'passwordChanged.greeting': 'Привет, {name}!',
    'passwordChanged.intro': 'Ваш пароль был успешно изменен {changedAt}.',
    'passwordChanged.sessionsInfo':
      'В целях безопасности, все ваши активные сессии были завершены.',
    'passwordChanged.buttonText': 'Войти',
    'passwordChanged.securityWarning':
      'Если это были не вы, немедленно свяжитесь с нами по адресу {supportEmail}',
    'passwordChanged.footer': 'С уважением, команда AMCore',

    // Organization Invite
    'orgInvite.subject': 'Приглашение в организацию {orgName}',
    'orgInvite.preview': '{inviterName} приглашает вас в {orgName} на AMCore',
    'orgInvite.title': 'Вас пригласили в {orgName}',
    'orgInvite.intro':
      '{inviterName} ({inviterEmail}) приглашает вас присоединиться к организации «{orgName}» в AMCore.',
    'orgInvite.roleInfo': 'Вам будет назначена роль: {roleName}.',
    'orgInvite.ctaSignIn': 'Войти и принять приглашение',
    'orgInvite.ctaSignUp': 'Создать аккаунт и присоединиться',
    'orgInvite.expiresInfo': 'Это приглашение действительно в течение {expiresIn}.',
    'orgInvite.ignoreInfo': 'Если вы не ожидали это приглашение, просто проигнорируйте письмо.',
    'orgInvite.footer': 'С уважением, команда AMCore',
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

    // Password Changed Notification
    'passwordChanged.subject': 'Your password was changed',
    'passwordChanged.preview': 'Your password was successfully changed',
    'passwordChanged.title': 'Password Changed',
    'passwordChanged.greeting': 'Hi, {name}!',
    'passwordChanged.intro': 'Your password was successfully changed {changedAt}.',
    'passwordChanged.sessionsInfo': 'For security, all your active sessions have been logged out.',
    'passwordChanged.buttonText': 'Log In',
    'passwordChanged.securityWarning':
      'If this was not you, please contact us immediately at {supportEmail}',
    'passwordChanged.footer': 'Best regards, AMCore team',

    // Organization Invite
    'orgInvite.subject': 'Invitation to join {orgName}',
    'orgInvite.preview': '{inviterName} invited you to {orgName} on AMCore',
    'orgInvite.title': 'You have been invited to {orgName}',
    'orgInvite.intro':
      '{inviterName} ({inviterEmail}) has invited you to join the "{orgName}" organization on AMCore.',
    'orgInvite.roleInfo': 'You will be assigned the role: {roleName}.',
    'orgInvite.ctaSignIn': 'Sign in to accept the invitation',
    'orgInvite.ctaSignUp': 'Create an account to join',
    'orgInvite.expiresInfo': 'This invitation is valid for {expiresIn}.',
    'orgInvite.ignoreInfo': 'If you were not expecting this invitation, simply ignore this email.',
    'orgInvite.footer': 'Best regards, AMCore team',
  },
} as const
