'use client'

import type { ComponentProps } from 'react'
import type { MfaMethod } from '@amcore/shared'

import { cn } from '@/shared/lib/utils'

import { Input } from './input'

/** One accessible field preserves whole-code paste and leading zeros in every MFA journey. */
export function MfaCodeInput({
  method,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<typeof Input>, 'onChange' | 'onPaste' | 'type'> & {
  method: MfaMethod
  onValueChange: (value: string) => void
}) {
  const totp = method === 'totp'
  return (
    <Input
      {...props}
      type="text"
      inputMode={totp ? 'numeric' : 'text'}
      autoComplete={totp ? 'one-time-code' : 'off'}
      maxLength={totp ? 6 : undefined}
      pattern={totp ? '[0-9]{6}' : undefined}
      className={cn(
        totp && 'h-12 w-48 max-w-full text-center font-mono text-2xl tracking-widest md:text-2xl',
        className
      )}
      spellCheck={false}
      autoCapitalize="off"
      onChange={(event) =>
        onValueChange(
          totp ? event.target.value.replace(/[^0-9]/g, '').slice(0, 6) : event.target.value
        )
      }
      onPaste={(event) => {
        if (!totp) return
        event.preventDefault()
        const code = event.clipboardData.getData('text').replace(/\s/g, '')
        if (/^[0-9]{1,6}$/.test(code)) onValueChange(code)
      }}
    />
  )
}
