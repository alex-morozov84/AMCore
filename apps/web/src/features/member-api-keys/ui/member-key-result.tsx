import { useTranslations } from 'next-intl'

import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
export interface MemberKeyNotice {
  kind: 'committed' | 'rejected' | 'unknown'
  error?: unknown
  count?: number
  refreshFailed?: boolean
}
export function MemberKeyResult({
  notice,
  onCheck,
  busy,
}: {
  notice: MemberKeyNotice
  onCheck: () => void
  busy: boolean
}) {
  const t = useTranslations('memberApiKeys')
  return (
    <section className="space-y-2 rounded-lg border p-3" aria-live="polite">
      <p>
        {notice.kind === 'committed' ? t('result', { count: notice.count ?? 0 }) : t(notice.kind)}
      </p>
      {notice.refreshFailed && <p>{t('refreshFailed')}</p>}
      <ApiErrorAlert error={notice.error} />
      <Button variant="outline" onClick={onCheck} disabled={busy}>
        {t('check')}
      </Button>
    </section>
  )
}
