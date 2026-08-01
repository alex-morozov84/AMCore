'use client'

import { useTranslations } from 'next-intl'

import { useAuthStore } from '@/shared/store'

export default function DashboardPage() {
  const t = useTranslations('dashboard')
  const user = useAuthStore((state) => state.user)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        {user?.name ? t('welcomeNamed', { name: user.name }) : t('welcome')}
      </h1>
      <p className="text-muted-foreground">{t('starterNotice')}</p>
    </div>
  )
}
