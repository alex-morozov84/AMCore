import { getTranslations } from 'next-intl/server'

export async function OverviewPage() {
  const t = await getTranslations('console')

  return (
    <section className="rounded-lg border border-border bg-surface-elevated p-6 shadow-md sm:p-8">
      <p className="font-[family-name:var(--console-font-mono)] text-xs tracking-[0.2em] text-foreground-muted uppercase">
        {t('overviewEyebrow')}
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-3 max-w-2xl text-foreground-muted">{t('placeholder')}</p>
    </section>
  )
}
