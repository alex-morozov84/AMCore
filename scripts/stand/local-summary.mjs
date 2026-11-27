export function localSummary(stand) {
  const { id, origins, ports, localePrefix, exercisedSettings: settings } = stand
  const russian = stand.baseLocale === 'ru'
  const tr = (en, ru) => (russian ? ru : en)
  const administration = settings['product-admin']
  const consolePath = stand.consoleTopology === 'host' ? '' : `/${stand.consoleSlug}`
  const staffUrl = stand.productAdminHost
    ? `${origins.staff}/`
    : `${origins.product}${localePrefix}/${administration.alias}`
  const consoleUrl = stand.consoleEnabled
    ? `${origins.console ?? origins.product}${localePrefix}${consolePath}`
    : tr('Disabled', 'Отключена')

  const consoleSignIn = stand.consoleTopology === 'host'
    ? `${consoleUrl}/login`
    : `${origins.product}${localePrefix}/login`

  const rows = (entries) => entries.map(([label, value]) => `  ${label.padEnd(20)} ${value}`)
  return [
    '',
    `✓ ${tr('Local stand ready', 'Локальный стенд готов')}`,
    '',
    tr('Open in browser', 'Открыть в браузере'),
    ...rows([
      [tr('Product', 'Продукт'), `${origins.product}${localePrefix}`],
      [tr('Product admin', 'Админка продукта'), staffUrl],
      [tr('Operations Console', 'Суперадминка'), consoleUrl],
    ]),
    ...(stand.consoleEnabled
      ? rows([[tr('Console sign-in', 'Вход в суперадминку'), `${consoleSignIn} (SUPER_ADMIN)`]])
      : []),
    '',
    tr('Services', 'Сервисы'),
    ...rows([
      ['API', origins.api],
      ['PostgreSQL', tr('postgres:5432 · Docker only', 'postgres:5432 · только внутри Docker')],
      ['Redis', `127.0.0.1:${ports.redis} · redis:6379 (Docker)`],
    ]),
    '',
    tr('Manage the stand', 'Управление стендом'),
    ...rows([
      [tr('Stand ID', 'ID стенда'), id],
      [tr('Status', 'Состояние'), 'pnpm local status'],
      [tr('Stop', 'Остановить'), 'pnpm local down'],
    ]),
    '',
  ].join('\n')
}
