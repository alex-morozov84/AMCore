import { getTranslations } from 'next-intl/server'

export async function OverviewPage() {
  const t = await getTranslations('console')

  return (
    <section className="border border-line-strong bg-surface-elevated p-6 sm:p-8">
      <p className="font-mono text-xs tracking-[0.2em] text-foreground-muted uppercase">
        {t('overviewEyebrow')}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-foreground-muted">{t('placeholder')}</p>
    </section>
  )
}
