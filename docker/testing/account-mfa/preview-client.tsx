'use client'

import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { DEMO_CODES, previewAdapter, type Scenario } from './preview-adapter'

import { AccountMfaController, AccountMfaJourney } from '@/features/account-mfa'
import { Button } from '@/shared/ui/button'

// Copied over the app adapter only in a managed preview source snapshot.
export function AccountSecurityClient(_props: { placement: unknown }) {
  const t = useTranslations('accountMfa.preview')
  const [scenario, setScenario] = useState<Scenario>('setup')
  const [instance, setInstance] = useState(0)
  const [left, setLeft] = useState(false)
  const [adapter, setAdapter] = useState(() => previewAdapter('setup'))
  const [controller, setController] = useState(() => new AccountMfaController(adapter))
  const select = (next: Scenario) => {
    controller.conceal()
    const nextAdapter = previewAdapter(next)
    setAdapter(nextAdapter)
    setController(new AccountMfaController(nextAdapter))
    setScenario(next)
    setInstance((value) => value + 1)
    setLeft(false)
  }
  return (
    <div className="w-full max-w-lg space-y-4">
      <aside className="space-y-3 rounded-md border bg-muted p-4 text-sm">
        <h2 className="font-semibold">{t('title')}</h2>
        <p>{t('description')}</p>
        <code className="block break-all select-text">{DEMO_CODES[0]}</code>
        {scenario === 'emergency' && (
          <code className="block break-all select-text">{'x'.repeat(43)}</code>
        )}
        <div className="flex flex-wrap gap-2">
          {(
            [
              'setup',
              'login',
              'last_code',
              'settings',
              'unknown',
              'expired',
              'password_setup',
              'emergency',
            ] as const
          ).map((item) => (
            <Button
              key={item}
              variant={scenario === item ? 'selection' : 'outline'}
              size="sm"
              aria-pressed={scenario === item}
              onClick={() => select(item)}
            >
              {t(item)}
            </Button>
          ))}
        </div>
      </aside>
      {left ? (
        <p role="status">{t('left')}</p>
      ) : (
        <AccountMfaJourney
          key={instance}
          controller={controller}
          passwordRecoveryHref="/forgot-password"
          onExit={() => setLeft(true)}
          onComplete={() => {
            adapter.settings()
            void controller.inspect()
          }}
        />
      )}
    </div>
  )
}
