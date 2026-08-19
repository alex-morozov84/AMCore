import { useTranslations } from 'next-intl'

interface DashboardPageProps {
  userName?: string | null
}

export function DashboardPage({ userName }: DashboardPageProps) {
  const t = useTranslations('dashboard')

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        {userName ? t('welcomeNamed', { name: userName }) : t('welcome')}
      </h1>
      <p className="text-muted-foreground">{t('starterNotice')}</p>
    </div>
  )
}
