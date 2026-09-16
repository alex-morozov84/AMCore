const ROOT = 'apps/api/src/core'

const contracts = [
  {
    path: `${ROOT}/auth/auth.controller.spec.ts`,
    required: [
      "const updated: UserResponse = { ...mockUserResponse, name: 'Renamed', locale: 'ru' }",
      "controller.updateProfile(mockUser.id, { name: 'Renamed', locale: 'ru' })",
      "name: 'Renamed',\n        locale: 'ru',",
    ],
  },
  {
    path: `${ROOT}/auth/auth.service.spec.ts`,
    required: [
      'uses the explicit body locale when supplied',
      "acceptedLocale: 'ru'",
      "data: expect.objectContaining({ locale: 'ru' })",
    ],
    forbidden: ["acceptedLocale: 'en'", "data: expect.objectContaining({ locale: 'en' })"],
  },
  {
    path: `${ROOT}/notifications/channels/telegram/telegram-content.spec.ts`,
    required: ["renderTelegram!(projection, 'ru')", "body: '(ru)'"],
    forbidden: ["renderTelegram!(projection, 'en')", "body: '(en)'"],
  },
  {
    path: `${ROOT}/notifications/notification-definition.registry.spec.ts`,
    required: [".toBe('Профиль обновлён')", "}, 'ru')"],
    forbidden: ["'en'"],
  },
  {
    path: `${ROOT}/organizations/invite.service.spec.ts`,
    required: ["expect(data.locale).toBe('ru')"],
    forbidden: ["expect(data.locale).toBe('en')"],
  },
  {
    path: `${ROOT}/notifications/notification-feed.service.spec.ts`,
    required: ["mockResolvedValue({ locale: 'ru' } as never)", "title: 'Профиль обновлён'"],
    forbidden: ["mockResolvedValue({ locale: 'en' } as never)", "title: 'Profile updated'"],
  },
  {
    path: `${ROOT}/notifications/definitions/account-password-changed.definition.ts`,
    required: ['ru-RU', 'Пароль изменён', 'Ваш пароль был изменён'],
    forbidden: ["locale === 'en'"],
  },
  {
    path: `${ROOT}/notifications/definitions/account-profile-updated.definition.ts`,
    required: ['Профиль обновлён', 'Вы изменили полей профиля'],
    forbidden: ["locale === 'en'"],
  },
  {
    path: `${ROOT}/notifications/definitions/account-telegram-linked.definition.ts`,
    required: ['Telegram подключён', 'Ваш аккаунт Telegram подключён'],
    forbidden: ["locale === 'en'"],
  },
]

function checkContract(contract, content) {
  const missing = contract.required
    .filter((value) => !content.includes(value))
    .map((value) => `${contract.path}:missing ${value}`)
  const stale = (contract.forbidden ?? [])
    .filter((value) => content.includes(value))
    .map((value) => `${contract.path}:stale ${value}`)
  return [...missing, ...stale]
}

export function ruNarrowingResiduals(locale, contents) {
  if (locale !== 'ru') return []
  return contracts.flatMap((contract) => checkContract(contract, contents.get(contract.path) ?? ''))
}
