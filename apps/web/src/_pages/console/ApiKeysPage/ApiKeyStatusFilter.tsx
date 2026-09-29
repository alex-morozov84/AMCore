'use client'

import { useTranslations } from 'next-intl'
import type { AdminApiKeyQuery } from '@amcore/shared'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/select'

const STATUSES = ['all', 'unexpired', 'expired', 'revoked'] as const
export function ApiKeyStatusFilter({
  status,
  onChange,
}: {
  status: AdminApiKeyQuery['status']
  onChange: (status: AdminApiKeyQuery['status']) => void
}) {
  const t = useTranslations('console.apiKeys')
  const items = STATUSES.map((value) => ({ value, label: t(value) }))
  return (
    <div className="space-y-1 text-sm">
      <label htmlFor="api-key-status">{t('status')}</label>
      <Select
        value={status}
        items={items}
        onValueChange={(value) => {
          if (STATUSES.some((status) => status === value))
            onChange(value as AdminApiKeyQuery['status'])
        }}
      >
        <SelectTrigger id="api-key-status" className="min-w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
