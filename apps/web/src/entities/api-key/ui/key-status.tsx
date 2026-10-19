import { useTranslations } from 'next-intl'
import { Ban, Clock3, KeyRound } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

const views = {
  unexpired: { Icon: KeyRound, className: 'border-success/60 bg-success-soft text-foreground' },
  expired: { Icon: Clock3, className: 'border-warning/60 bg-warning-soft text-foreground' },
  revoked: { Icon: Ban, className: 'border-border bg-muted text-muted-foreground' },
} as const
export function KeyStatus({ status }: { status: keyof typeof views }) {
  const t = useTranslations('apiKeyPresentation')
  const { Icon, className } = views[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium',
        className
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {t(status === 'revoked' ? 'revokedSingle' : status)}
    </span>
  )
}
