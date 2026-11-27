import { readAdminConsoleSettings, readProductAdminPlacement } from './settings-files.mjs'

export async function administration(root, a, p) {
  const { tr, select, text, note, info } = p
  const console = readAdminConsoleSettings(root)
  const staff = readProductAdminPlacement(root)
  const prefix = a.locales.includes(',') ? `/${a.defaultLocale}` : ''
  const consolePath = `${prefix}/${console.alias}`
  if (console.mode !== 'host')
    note(
      `Operators (SUPER_ADMIN) monitor system health and background work. Example path: ${consolePath}. You can later rename the path segment or move to ops.example.com with a separate login. See docs/operations-console/configuration.md.`,
      `Операторы (SUPER_ADMIN) следят за состоянием системы и фоновыми задачами. Пример адреса: ${consolePath}. Позже можно сменить часть адреса (алиас) или перенести консоль на ops.example.com с отдельным входом. См. docs/operations-console/configuration.md.`
    )
  if (console.mode === 'host')
    info(
      'Existing Console host placement will be kept.',
      'Текущее размещение консоли на отдельном хосте сохранится.'
    )
  else
    await select(
      'consoleMode',
      tr(
        'Enable the Operations Console on the main site?',
        'Включить консоль оператора на основном сайте?'
      ),
      [
        ['path', 'Yes', 'Да'],
        ['disabled', 'No', 'Нет'],
      ],
      console.mode
    )
  const staffPath =
    staff.mode === 'host'
      ? `https://staff.example.com${prefix}/organizations`
      : `${prefix}/${staff.alias}`
  note(
    `Use this panel for your product's administration. AMCore includes pages for team and access management. Add your own sections if your product needs them.\n\nThe panel normally uses /manage on the main site and shares its sign-in. Current address example: ${staffPath}. Access depends on user permissions.\n\nLater, you can change the path to /team or use a separate host such as staff.example.com. A separate host requires its own sign-in. The wizard keeps the current placement.`,
    `Здесь можно разместить функции управления вашим продуктом. В AMCore уже есть страницы для работы с командой и правами доступа. Если продукту нужна административная панель, вы можете добавить свои разделы.\n\nПо умолчанию панель находится на основном сайте по адресу /manage. Вход общий с сайтом, а доступ зависит от прав пользователя. Пример адреса с текущими настройками: ${staffPath}.\n\nПозже можно изменить путь, например на /team, или перенести панель на staff.example.com. На отдельном адресе потребуется войти отдельно. Мастер сохранит текущее размещение.`
  )
  const help = await select(
    'staffHelp',
    tr('Administration panel', 'Административная панель'),
    [
      ['continue', 'Continue', 'Продолжить'],
      ['help', 'Show address-change instructions', 'Как изменить адрес панели?'],
    ],
    'continue'
  )
  if (help === 'help') {
    info(
      'Edit product-admin.json. When renaming the alias, move the matching route folder. For a host, configure origins, DNS and HTTPS. Regenerate the proxy files, validate placement and rebuild. See docs/product-admin/placement-and-sessions.md#configure-or-move-the-administration-area.',
      'Измените product-admin.json. При смене алиаса переименуйте папку маршрутов. Для отдельного хоста настройте адреса сервисов, DNS и HTTPS. Обновите конфигурацию прокси, проверьте размещение и пересоберите проект. Команды приведены в docs/product-admin/placement-and-sessions.md#configure-or-move-the-administration-area.'
    )
  }
  note(
    'If someone adds the site to their phone home screen, they see this icon beside other apps. You can keep the current icon during development and replace it later. To add your own, prepare PNG files in the sizes shown on the next step.',
    'Если пользователь добавит сайт на главный экран телефона, он увидит эту иконку рядом с другими приложениями. Можно оставить текущую иконку на время разработки и заменить её позже. Если хотите добавить свою, мастер подскажет, какие PNG-файлы подготовить.'
  )
  if (
    (await select(
      'icons',
      tr(
        'Which icon should users see when they install the site as an app?',
        'Какую иконку использовать, если пользователь установит сайт как приложение?'
      ),
      [
        ['keep', 'Keep the current icon', 'Оставить текущую иконку'],
        ['replace', 'Add my own icon', 'Добавить свою иконку'],
      ],
      'keep'
    )) === 'replace'
  ) {
    await text(
      'icon192Src',
      tr(
        'PNG 192 × 192, small icon (optional)',
        'PNG 192 × 192, маленькая иконка (можно пропустить)'
      )
    )
    await text(
      'icon512Src',
      tr('PNG 512 × 512, large icon (optional)', 'PNG 512 × 512, крупная иконка (можно пропустить)')
    )
    await text(
      'icon512MaskableSrc',
      tr(
        'PNG 512 × 512, crop-safe icon (optional; keep artwork inside the central 80% circle)',
        'PNG 512 × 512 для обрезки по форме (можно пропустить). Важные детали оставьте в центральном круге диаметром 80%.'
      )
    )
  }
}
