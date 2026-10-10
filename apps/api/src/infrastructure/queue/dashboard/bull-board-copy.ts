/**
 * Fixed operator-facing strings of the queue board, in the Console locales. They live here (API
 * side) because the board's own chrome is rendered by the API; the Console's own text is in the web
 * message catalogues. Nothing here carries data from a job.
 */
export type BoardLocale = 'en' | 'ru'

export const BOARD_HIDDEN = '[hidden]'

interface BoardCopy {
  readonly boardTitle: string
  readonly readOnlyLabel: string
  readonly logsHidden: string
  readonly failureHidden: string
  readonly backToConsole: string
  readonly notDisplayed: string
}

const COPY: Readonly<Record<BoardLocale, BoardCopy>> = {
  en: {
    boardTitle: 'Queue board — view only',
    readOnlyLabel: 'READ-ONLY',
    logsHidden: 'Logs are not displayed in this board.',
    failureHidden: 'Failure details are not displayed in this board.',
    backToConsole: 'Back to Console',
    notDisplayed: 'Not displayed',
  },
  ru: {
    boardTitle: 'Панель очередей — только просмотр',
    readOnlyLabel: 'ТОЛЬКО ПРОСМОТР',
    logsHidden: 'Журналы в этой панели не отображаются.',
    failureHidden: 'Сведения об ошибке в этой панели не отображаются.',
    backToConsole: 'Назад в консоль',
    notDisplayed: 'Не отображается',
  },
}

export function boardCopy(locale: BoardLocale | undefined): BoardCopy {
  return COPY[locale ?? 'en']
}

/** Locale tags of the bundled board UI (`@bull-board/ui` ships `en-US` and `ru-RU`). */
export function boardLanguage(locale: BoardLocale | undefined): 'en-US' | 'ru-RU' {
  return locale === 'ru' ? 'ru-RU' : 'en-US'
}
