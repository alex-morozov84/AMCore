import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMarkdownField } from './actions.mjs'
import { parseCiPolicy } from './ci-policy.mjs'
import { DEFAULT_TEAM_PROCESS, TEAM_PROCESS_FIELD, teamProcessError } from './team-process.mjs'

async function askTeamProcess(root, answers, context, { tr, select, text, note }) {
  if (answers.teamProcess !== undefined) return
  const repeat = readMarkdownField(context, 'Mode')?.includes('downstream-product')
  const current = readMarkdownField(context, TEAM_PROCESS_FIELD) ?? DEFAULT_TEAM_PROCESS
  const options = [
    ['amcore', 'AMCore process (default)', 'Процесс AMCore (по умолчанию)'],
    ['file', 'Our rules from a file', 'Наши правила из файла'],
  ]
  const gitReference =
    answers.workflowMode === 'custom' &&
    (answers.workflowReference ?? readMarkdownField(context, 'Workflow reference'))
  const gitFile = gitReference && `file:${gitReference}`
  if (gitFile && !teamProcessError(root, gitFile, tr))
    options.push([
      'git',
      'Use the Git rules file for team process too',
      'Использовать файл правил Git и для процесса команды',
    ])
  if (repeat) options.unshift(['keep', 'Keep the current choice', 'Оставить текущий выбор'])
  note(
    'Choose how the team plans, tests and reviews work. Git delivery and CI stay separate. You can change this in PROJECT_CONTEXT.md later.',
    'Выберите порядок планирования, проверок и ревью. Режим поставки через Git и настройки CI задаются отдельно. Позже процесс можно сменить в PROJECT_CONTEXT.md.'
  )
  if (repeat)
    note(`Current choice: ${JSON.stringify(current)}`, `Текущий выбор: ${JSON.stringify(current)}`)
  const choice = await select(
    'teamProcessChoice',
    tr(
      'Which process should your team and agents follow for development?',
      'По каким правилам команда и агенты будут вести разработку?'
    ),
    options,
    repeat ? 'keep' : 'amcore'
  )
  if (choice === 'amcore') answers.teamProcess = DEFAULT_TEAM_PROCESS
  if (choice === 'git') answers.teamProcess = gitFile
  if (choice !== 'file') return

  note(
    'Enter a tracked Markdown path inside this repository, for example docs/team/Our process.md.',
    'Укажите путь к Markdown-файлу, который отслеживается Git в этом репозитории. Пример — docs/team/Наш процесс.md.'
  )
  const file = await text(
    'teamProcessPath',
    tr('Path to the team rules', 'Путь к файлу правил команды'),
    undefined,
    (input) => teamProcessError(root, `file:${input}`, tr)
  )
  answers.teamProcess = `file:${file}`
}

export async function repository(root, a, p) {
  const { tr, select, text, note } = p
  const context = readFileSync(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const workflow =
    readMarkdownField(context, 'Workflow mode')?.match(/\b(strict|custom|flexible)\b/)?.[1] ??
    'strict'
  note(
    'main is the primary branch. A pull request asks to merge changes into it. In strict mode, configure branch protection in GitHub to require a pull request and passing checks. Flexible mode lets your team set exceptions. For custom Git delivery, provide the location of your Git rules. The wizard records your choice in PROJECT_CONTEXT.md. You can change it later.',
    'main — основная ветка проекта. Pull request — запрос на добавление изменений в эту ветку. Для строгого режима настройте защиту ветки в GitHub. Тогда GitHub потребует запрос на слияние и успешные проверки. При гибких правилах команда сама решает, когда нужен запрос. Для своей поставки через Git укажите, где описаны правила Git. Мастер запишет выбор в PROJECT_CONTEXT.md. Его можно изменить позже.'
  )
  await select(
    'workflowMode',
    tr(
      'How will the team accept changes into main?',
      'Как команда будет вносить изменения в основную ветку main?'
    ),
    [
      [
        'strict',
        'Pull requests with required checks; configure branch protection on GitHub',
        'Запросы на слияние с обязательными проверками. Защиту ветки настройте в GitHub',
      ],
      ['flexible', 'Flexible team rules', 'Гибкие правила команды'],
      ['custom', 'Custom Git delivery rules', 'Свои правила поставки через Git'],
    ],
    workflow
  )
  if (a.workflowMode === 'custom')
    await text(
      'workflowReference',
      tr('Path or URL of the Git delivery rules', 'Путь или ссылка на правила поставки через Git'),
      readMarkdownField(context, 'Workflow reference')
    )
  note(
    'GitHub Actions can check the code, build the app and run tests after a push or pull request. Choose how much it should check. A public AMCore run took 19 minutes to finish and used 203 combined runner minutes because jobs ran in parallel. Private repositories use the plan allowance and may incur charges above it. This is an example; your run may differ. Change the mode later in ci/product.json.\n\nnormal selects checks for affected parts. full runs all applicable checks. heavy-off keeps quick checks, migration history and secret scanning. It skips the build and browser/API scenarios. You can run the full set manually.',
    'GitHub Actions может проверить код, собрать приложение и запустить тесты после отправки изменений или открытия pull request. Выберите объём проверок.\n\nОдин прогон AMCore занял около 19 минут. Задания шли параллельно и суммарно использовали 203 минуты работы машин GitHub. В приватном репозитории эта работа расходует объём, включённый в тариф. Сверх него возможна плата. Для вашего проекта время может отличаться. Режим можно изменить позже в ci/product.json.\n\nnormal проверяет затронутые части. full запускает все применимые проверки. heavy-off оставляет быстрые проверки, проверку истории миграций и поиск секретов. Сборка и проверки через браузер и API пропускаются. Полный набор можно запустить вручную.'
  )
  await select(
    'ciMode',
    tr(
      'Which checks should GitHub run automatically?',
      'Какие проверки GitHub запускать автоматически?'
    ),
    [
      [
        'normal',
        'Checks for affected parts (recommended)',
        'Проверки затронутых частей (рекомендуется)',
      ],
      ['full', 'Full applicable plan', 'Полный применимый набор'],
      [
        'heavy-off',
        'Quick checks; skip build and runtime tests',
        'Быстрые проверки, без сборки и тестов работающего приложения',
      ],
    ],
    parseCiPolicy(readFileSync(join(root, 'ci/product.json'), 'utf8')).mode
  )
  await askTeamProcess(root, a, context, p)
  note(
    'Your product is based on AMCore. Later releases may include fixes and new features. Your team decides when to adopt them. The wizard records the starting version and your policy in PROJECT_CONTEXT.md. Download and apply updates separately. You can change the policy later. Example: “Review releases monthly.”',
    'Ваш продукт создаётся на основе AMCore. В следующих выпусках могут появляться исправления и новые возможности. Команда сама решает, когда их принять.\n\nМастер запишет исходную версию AMCore и ваше решение в PROJECT_CONTEXT.md. Обновления вы загружаете и применяете отдельно. Порядок можно изменить позже. Пример своего правила — «Проверяем релизы раз в месяц».'
  )
  const policy = await select(
    'updateChoice',
    tr(
      'How will you handle AMCore updates? (team note only)',
      'Как команда будет обновлять основу проекта из AMCore?'
    ),
    [
      ['review', 'Review releases before updating', 'Проверять релизы перед обновлением'],
      ['later', 'Keep current policy or decide later', 'Сохранить текущее решение или отложить'],
      ['custom', 'Describe your policy', 'Описать свой порядок'],
    ],
    'later'
  )
  if (!a.upstreamSyncPolicy && policy === 'review')
    a.upstreamSyncPolicy = 'Review AMCore releases before updating.'
  if (policy === 'custom')
    await text(
      'upstreamSyncPolicy',
      tr('Update policy', 'Порядок обновления'),
      readMarkdownField(context, 'Upstream sync policy')
    )
}
