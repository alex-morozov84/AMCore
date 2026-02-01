'use client'

import { useAuthStore } from '@/shared/store'

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">
        {user?.name ? `Привет, ${user.name}!` : 'Добро пожаловать!'}
      </h1>
      <p className="text-muted-foreground">
        Это ваш личный дашборд. Скоро здесь появятся модули Fitness, Finance и Subscriptions.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">Fitness</h2>
          <p className="text-sm text-muted-foreground">Скоро</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">Finance</h2>
          <p className="text-sm text-muted-foreground">Скоро</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-semibold">Subscriptions</h2>
          <p className="text-sm text-muted-foreground">Скоро</p>
        </div>
      </div>
    </div>
  )
}
