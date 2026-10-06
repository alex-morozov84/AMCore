export const E2E_UI_PROFILES = Object.freeze({
  auth: [
    ['/password/i', '/пароль/i'],
    ['/^password$/i', '/^пароль$/i'],
    ['/name/i', '/имя/i'],
    ['/sign in/i', '/войти/i'],
    ['/sign up/i', '/регистрация/i'],
    ['/sign out/i', '/выйти/i'],
    ['/forgot your password/i', '/забыли пароль\\?/i'],
    ['/continue with google/i', '/продолжить с google/i'],
    ['/send reset link/i', '/отправить ссылку/i'],
    [
      "/we've sent a link to reset your password/i",
      '/мы отправили ссылку для восстановления пароля/i',
    ],
    ['/resend verification email/i', '/отправить письмо повторно/i'],
    ["/we've sent a new verification link/i", '/мы отправили новую ссылку для подтверждения/i'],
    ['/request a new link/i', '/запросить новую ссылку/i'],
    ['/new password/i', '/новый пароль/i'],
    ['/reset password/i', '/сбросить пароль/i'],
    ['/your password has been reset/i', '/пароль успешно изменён/i'],
    ['/resend verification/i', '/отправить письмо повторно/i'],
  ],
  common: [["'Something went wrong'", "'Что-то пошло не так'"]],
  console: [
    ['/email/i', '/электронная почта/i'],
    ['/password/i', '/пароль/i'],
    ['/sign in/i', '/войти/i'],
    ['/sign out/i', '/выйти/i'],
  ],
  storageSetting: [
    ["'File storage'", "'Файловое хранилище'"],
    ["'Probe interval (seconds)'", "'Интервал проверки (секунды)'"],
    ["'Save'", "'Сохранить'"],
    ["'Cancel'", "'Отмена'"],
  ],
  consoleSessions: [
    ["'Sessions (2 total)'", "'Сессии (всего: 2)'"],
    ["'Refresh'", "'Обновить'"],
    ['/sessions \\(/i', '/сессии \\(/i'],
    ['/Sessions \\(2 total\\)/i', '/Сессии \\(всего: 2\\)/i'],
    ['/Sessions \\(1 total\\)/', '/Сессии \\(всего: 1\\)/'],
    ['/actions for session/i', '/действия для сессии/i'],
    ['/revoke session/i', '/отозвать сессию/i'],
    ['/revoke all sessions/i', '/отозвать все сессии/i'],
    ["'Revoke all sessions'", "'Отозвать все сессии'"],
    ['/no active sessions/i', '/нет активных сессий/i'],
    ["'No active sessions.'", "'Нет активных сессий.'"],
    ['/confirm your password/i', '/подтвердите пароль/i'],
    ['/confirm/i', '/подтвердить/i'],
    ['/manage your own sessions/i', '/чтобы управлять своими сессиями/i'],
    ["'Chrome on Windows'", "'Chrome на Windows'"],
  ],
  dashboard: [
    ["'Welcome'", "'Добро пожаловать'"],
    ["'Welcome!'", "'Добро пожаловать!'"],
  ],
  errors: [["'This link is invalid or has expired.'", "'Ссылка недействительна или устарела.'"]],
  nav: [
    ['/toggle sidebar/i', '/переключить боковую панель/i'],
    ["'Navigation'", "'Навигация'"],
  ],
  sessions: [
    ["'This device'", "'Это устройство'"],
    ["'Active sessions'", "'Активные сессии'"],
    ['/actions/i', '/действия/i'],
    ['/revoke/i', '/отозвать/i'],
  ],
})

const surface = (path, namespaces, expectedReferences) => ({
  path,
  namespaces,
  expectedReferences,
})

export const E2E_UI_SURFACES = Object.freeze([
  surface('apps/web/e2e/shared/storage-setting-journey.ts', ['storageSetting'], 6),
  surface('apps/web/e2e/real-stack/storage-runtime-settings.spec.ts', ['storageSetting'], 1),
  surface('apps/web/e2e/console-real-stack/storage-runtime-settings.spec.ts', ['console'], 3),
  surface(
    'apps/web/e2e/real-stack/admin-sessions/sessions.spec.ts',
    ['auth', 'consoleSessions'],
    27
  ),
  surface('apps/web/e2e/console-real-stack/sessions.spec.ts', ['console', 'consoleSessions'], 10),
  surface('apps/web/e2e/console-real-stack/session-isolation.spec.ts', ['console'], 5),
  surface('apps/web/e2e/mocked/accessibility.spec.ts', ['auth'], 2),
  surface('apps/web/e2e/mocked/api-error-rendering.spec.ts', ['auth', 'common'], 3),
  surface('apps/web/e2e/mocked/login-validation.spec.ts', ['auth'], 5),
  surface('apps/web/e2e/mocked/route-progress-bar.spec.ts', ['auth'], 5),
  surface('apps/web/e2e/server-mocked/oauth-visibility.spec.ts', ['auth'], 2),
  surface('apps/web/e2e/real-stack/helpers.ts', ['auth'], 5),
  surface('apps/web/e2e/real-stack/accessibility.spec.ts', ['sessions'], 4),
  surface('apps/web/e2e/real-stack/app-shell.spec.ts', ['nav', 'sessions'], 5),
  surface('apps/web/e2e/real-stack/auth-email-link-flows.spec.ts', ['auth', 'errors'], 16),
  surface('apps/web/e2e/real-stack/csp-nonce.spec.ts', ['nav'], 1),
  surface('apps/web/e2e/real-stack/credential-containment.spec.ts', ['auth'], 1),
  surface('apps/web/e2e/real-stack/login.spec.ts', ['auth', 'dashboard'], 2),
  surface('apps/web/e2e/real-stack/register-and-logout.spec.ts', ['auth', 'dashboard'], 2),
  surface('apps/web/e2e/real-stack/sessions.spec.ts', ['sessions'], 5),
  surface('apps/web/e2e/real-stack/admin-sessions/readability.spec.ts', ['consoleSessions'], 4),
  surface('apps/web/e2e/real-stack/sessions-readability.spec.ts', ['sessions'], 5),
])

export const E2E_UI_EXPECTATION_DENOMINATOR = E2E_UI_SURFACES.reduce(
  (total, item) => total + item.expectedReferences,
  0
)
