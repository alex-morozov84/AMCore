import { getTranslations } from 'next-intl/server'

export async function ConsolePlaceholderPage() {
  const t = await getTranslations('console')

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-3 text-muted-foreground">{t('placeholder')}</p>
      </section>
    </main>
  )
}
