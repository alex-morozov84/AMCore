'use client'

import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'

import { Button } from '@/shared/ui/button'

import { useLogout } from '../model/use-logout'

interface LogoutButtonProps {
  variant?: 'default' | 'ghost' | 'outline'
  showIcon?: boolean
  showText?: boolean
  className?: string
}

export function LogoutButton({
  variant = 'ghost',
  showIcon = true,
  showText = true,
  className,
}: LogoutButtonProps) {
  const t = useTranslations('auth')
  const { mutate, isPending } = useLogout()

  return (
    <Button
      variant={variant}
      onClick={() => mutate()}
      disabled={isPending}
      className={className}
      // Icon-only (`showText={false}`, `(dashboard)/layout.tsx`'s header)
      // otherwise has no accessible name at all — found while writing the
      // Track 7 real-stack E2E logout flow.
      aria-label={showText ? undefined : t('logout')}
    >
      {showIcon && <LogOut className="size-4" />}
      {showText && t('logout')}
    </Button>
  )
}
