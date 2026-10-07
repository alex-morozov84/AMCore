'use client'

import { type ComponentProps, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/shared/lib/utils'

import { Button } from './button'
import { Input } from './input'

type PasswordInputProps = Omit<ComponentProps<'input'>, 'type'> & {
  showLabel: string
  hideLabel: string
}

/** Presentation only: callers own values, validation, autocomplete and localized labels. */
export function PasswordInput({
  showLabel,
  hideLabel,
  className,
  disabled,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOff : Eye
  return (
    <div className="relative">
      <Input
        {...props}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        className="absolute top-1/2 right-1 -translate-y-1/2"
        aria-label={visible ? hideLabel : showLabel}
        onClick={() => setVisible((value) => !value)}
      >
        <Icon aria-hidden="true" className="size-4" />
      </Button>
    </div>
  )
}
