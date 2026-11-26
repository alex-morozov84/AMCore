import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readProductAdminPlacement, readAdminConsoleSettings } from './settings-files.mjs'
import { proposedLocales } from './product-settings-plan.mjs'

export function printProductSummary(root, answers, plan) {
  if (!answers.interactive && !answers.locales && !answers.defaultLocale) return
  const ru = answers.language === 'ru'
  const tr = (en, russian) => (ru ? russian : en)
  const read = (file) =>
    plan.displaySteps.find((step) => relative(root, step.target) === file)?.after ??
    readFileSync(join(root, file), 'utf8')
  const locales = proposedLocales(root, answers)
  const admin = readAdminConsoleSettings(root)
  const staff = readProductAdminPlacement(root)
  const addresses = (area, host, landing = '/') =>
    locales.enabled
      .map((locale) => {
        const prefix = locales.enabled.length > 1 ? `/${locale}` : ''
        if (area.mode === 'disabled') return tr('disabled', 'отключено')
        return area.mode === 'host'
          ? `https://${host}${prefix}${landing}`
          : `${prefix}/${area.alias}`
      })
      .filter((value, index, list) => list.indexOf(value) === index)
      .join(', ')
  console.log(tr('\nProduct settings', '\nНастройки продукта'))
  console.log(
    tr('Site languages:', 'Языки сайта:'),
    locales.enabled.join(', '),
    tr('— default:', '— по умолчанию:'),
    locales.default
  )
  for (const locale of locales.enabled) {
    const { title, description } = JSON.parse(read(`apps/web/messages/${locale}.json`)).meta
    console.log(`  ${locale} <title>: ${title}; <meta name="description">: ${description}`)
  }
  console.log(
    tr('Console address examples:', 'Примеры адресов консоли:'),
    addresses({ ...admin, mode: answers.consoleMode ?? admin.mode }, 'ops.example.com')
  )
  console.log(
    tr('Product administration address examples:', 'Примеры адресов управления продуктом:'),
    addresses(staff, 'staff.example.com', '/organizations')
  )
  const themes = {
    both: tr('light and dark', 'светлая и тёмная'),
    light: tr('light only', 'только светлая'),
    dark: tr('dark only', 'только тёмная'),
  }
  const themeDefaults = {
    system: tr('follow device', 'как на устройстве'),
    light: tr('light', 'светлая'),
    dark: tr('dark', 'тёмная'),
  }
  if (answers.themeAvailability)
    console.log(
      tr('Themes:', 'Темы:'),
      themes[answers.themeAvailability],
      themeDefaults[answers.themeMode] ?? ''
    )
  if (answers.routeProgress)
    console.log(
      tr('Progress bar:', 'Полоска загрузки:'),
      answers.routeProgress === 'on' ? tr('on', 'включена') : tr('off', 'выключена')
    )
  if (answers.purpose) console.log(tr('Purpose:', 'Назначение:'), answers.purpose)
  if (answers.packageName) console.log(tr('Package name:', 'Имя пакета:'), answers.packageName)
  if (answers.workflowMode)
    console.log(tr('Team workflow:', 'Правила команды:'), answers.workflowMode)
  if (answers.upstreamSyncPolicy)
    console.log(tr('AMCore updates:', 'Обновления AMCore:'), answers.upstreamSyncPolicy)
  if (answers.ciMode)
    console.log(tr('Automatic checks:', 'Автоматические проверки:'), answers.ciMode)
  if (!(answers.icon192Src || answers.icon512Src || answers.icon512MaskableSrc))
    console.log(tr('Existing install icons are retained.', 'Текущие иконки установки сохраняются.'))
}
