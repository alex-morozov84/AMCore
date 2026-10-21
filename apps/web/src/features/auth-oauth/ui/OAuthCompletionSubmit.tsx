'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/shared/ui/button'

/** Native form remains usable before hydration and with JavaScript disabled. */
export function OAuthCompletionSubmit() {
  const t = useTranslations('auth.oauthCompletion')
  const button = useRef<HTMLButtonElement>(null)
  const started = useRef(false)
  const submitted = useRef(false)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    const form = button.current?.form
    if (!form) return
    const onSubmit = (event: SubmitEvent) => {
      if (submitted.current) event.preventDefault()
      else {
        submitted.current = true
        setPending(true)
      }
    }
    form.addEventListener('submit', onSubmit)
    if (!started.current) {
      started.current = true
      form.requestSubmit(button.current!)
    }
    return () => form.removeEventListener('submit', onSubmit)
  }, [])
  return (
    <Button ref={button} type="submit" className="w-full" disabled={pending}>
      {t('continue')}
    </Button>
  )
}
