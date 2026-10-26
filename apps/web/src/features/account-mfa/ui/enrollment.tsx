'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { MfaProof } from '@amcore/shared'
import QRCode from 'qrcode'

import { CopyButton } from '@/shared/ui/copy-button'
import { Disclosure } from '@/shared/ui/disclosure'

import { copyMfaSecret } from '../model/secret-actions'

import { MfaActionButton as Button } from './actions'
import { MfaProofForm } from './proof-form'

function EnrollmentQr({ uri }: { uri: string }) {
  const t = useTranslations('accountMfa')
  let modules
  try {
    modules = QRCode.create(uri, { errorCorrectionLevel: 'M' }).modules
  } catch {
    return <p role="status">{t('qrUnavailable')}</p>
  }
  const path: string[] = []
  for (let row = 0; row < modules.size; row++)
    for (let column = 0; column < modules.size; column++)
      if (modules.get(row, column)) path.push(`M${column + 4},${row + 4}h1v1h-1z`)
  return (
    <svg
      role="img"
      aria-label={t('qrLabel')}
      viewBox={`0 0 ${modules.size + 8} ${modules.size + 8}`}
      className="mx-auto size-56 max-w-full bg-qr-background text-qr-foreground"
      shapeRendering="crispEdges"
    >
      <path d={path.join('')} fill="currentColor" />
    </svg>
  )
}

export function MfaEnrollment({
  secret,
  uri,
  pending,
  onSubmit,
  onBack,
  replacing = false,
}: {
  secret: string
  uri: string
  pending: boolean
  onSubmit: (proof: MfaProof) => void
  onBack: () => void
  replacing?: boolean
}) {
  const t = useTranslations('accountMfa')
  const [manualCopy, setManualCopy] = useState(false)
  return (
    <div className="space-y-4">
      <ol className="list-inside list-decimal space-y-2">
        <li>{t('installApp')}</li>
        <li>{t('scanQr')}</li>
        <li>{t('enterAppCode')}</li>
      </ol>
      <EnrollmentQr uri={uri} />
      <Disclosure label={t('manualEntry')}>
        <p className="mb-2">{t('manualDescription')}</p>
        <div className="flex items-start gap-2">
          <code className="min-w-0 break-all select-text">{secret}</code>
          <CopyButton
            label={t('copyKey')}
            copied={t('copied')}
            failed={t('manualCopy')}
            onCopy={async () => {
              const copied = await copyMfaSecret(secret)
              setManualCopy(!copied)
              return copied
            }}
          />
        </div>
        {manualCopy && <p role="status">{t('manualCopy')}</p>}
      </Disclosure>
      <MfaProofForm
        method="totp"
        pending={pending}
        onSubmit={onSubmit}
        submitLabel={t(replacing ? 'replaceApp' : 'continue')}
        destructive={replacing}
        secondaryActions={
          <Button type="button" variant="outline" disabled={pending} onClick={onBack}>
            {t('back')}
          </Button>
        }
      />
    </div>
  )
}
