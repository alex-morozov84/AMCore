import type { getFormatter, getTranslations } from 'next-intl/server'

export type OverviewTranslations = Awaited<ReturnType<typeof getTranslations<'console'>>>
export type OverviewFormatter = Awaited<ReturnType<typeof getFormatter>>
