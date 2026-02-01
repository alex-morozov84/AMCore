'use client'

import { useTranslations } from 'next-intl'
import { LogOut } from 'lucide-react'

import { Button } from '@/shared/ui'

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
    <Button variant={variant} onClick={() => mutate()} disabled={isPending} className={className}>
      {showIcon && <LogOut className="size-4" />}
      {showText && t('logout')}
    </Button>
  )
}
