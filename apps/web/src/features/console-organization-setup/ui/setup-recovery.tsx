'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'

import type { SetupFlow } from './bound-setup'

export function SetupRecovery({ flow, throttled }: { flow: SetupFlow; throttled: boolean }) {
  const t = useTranslations('console.organizationSetup')
  const pending = flow.record?.pending
  if (!pending) return null
  const state = flow.status.data?.state
  const completed = state === 'completed-intact' || state === 'completed-changed'
  if (state === 'completed-changed' || (completed && pending.kind === 'prepare')) return null
  const canRepeat = pending.kind === 'bootstrap' || state === 'eligible-empty'
  return (
    <div className="max-w-2xl space-y-3 rounded-md border p-4">
      <p role="status">
        {t(
          flow.busy
            ? 'pending'
            : completed
              ? 'completedPending'
              : flow.uncertain
                ? 'unknown'
                : 'savedIntent'
        )}
      </p>
      <p className="break-words font-medium">
        {pending.kind === 'prepare'
          ? pending.input.email
          : `${pending.input.name} (${pending.input.slug})`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={flow.busy || throttled || flow.status.isFetching}
          onClick={() => void flow.refresh()}
        >
          {t('checkResult')}
        </Button>
        {canRepeat && (
          <Button disabled={flow.busy || throttled} onClick={flow.repeat}>
            {t(completed ? 'confirmResult' : 'repeat')}
          </Button>
        )}
        {flow.canCorrect && (
          <Button variant="outline" onClick={flow.correct}>
            {t('correct')}
          </Button>
        )}
      </div>
    </div>
  )
}
