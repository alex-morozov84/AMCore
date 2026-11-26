import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readMarkdownField } from './actions.mjs'
import { parseCiPolicy } from './ci-policy.mjs'

export async function repository(root, a, p) {
  const { tr, select, text, note } = p
  const context = readFileSync(join(root, 'PROJECT_CONTEXT.md'), 'utf8')
  const workflow =
    readMarkdownField(context, 'Workflow mode')?.match(/\b(strict|custom|flexible)\b/)?.[1] ??
    'strict'
  note(
    'main is the primary branch. A pull request asks to merge changes into it. In strict mode, configure branch protection in GitHub to require a pull request and passing checks. Flexible mode lets your team set exceptions. For a custom process, provide the location of your rules. The wizard records your choice in PROJECT_CONTEXT.md. You can change it later.',
    'main — основная ветка проекта. Pull request — запрос на добавление изменений в эту ветку. Для строгого режима настройте защиту ветки в GitHub. Тогда GitHub потребует запрос на слияние и успешные проверки. При гибких правилах команда сама решает, когда нужен запрос. Для собственного процесса укажите, где описаны правила. Мастер запишет выбор в PROJECT_CONTEXT.md. Его можно изменить позже.'
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
      ['custom', 'Custom process', 'Собственный процесс'],
    ],
    workflow
  )
  if (a.workflowMode === 'custom')
    await text(
      'workflowReference',
      tr('Path or URL of the custom rules', 'Путь или ссылка на правила команды'),
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
