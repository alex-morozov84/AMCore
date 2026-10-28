'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Checkbox } from '@/shared/ui/checkbox'
import { CopyButton } from '@/shared/ui/copy-button'

import { copyMfaSecret, downloadMfaCodes } from '../model/secret-actions'

import { MfaActionButton as Button, MfaActions } from './actions'

export function MfaBackupCodes({
  codes,
  pending,
  onSaved,
  setup,
}: {
  codes: string[]
  pending: boolean
  onSaved: () => void
  setup: boolean
}) {
  const t = useTranslations('accountMfa')
  const [saved, setSaved] = useState(false)
  const [manual, setManual] = useState(false)
  return (
    <div className="space-y-4">
      <p>{t(setup ? 'codesDescription' : 'newCodesDescription')}</p>
      <ul
        aria-label={t('backupCodesTitle')}
        className="grid gap-2 rounded-md border bg-muted p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code} className="break-all select-text">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton
          label={t('copyCodes')}
          copied={t('copied')}
          failed={t('manualSave')}
          onCopy={async () => {
            const copied = await copyMfaSecret(codes.join('\n'))
            setManual(!copied)
            return copied
          }}
        />
        <Button variant="outline" onClick={() => setManual(!downloadMfaCodes(codes))}>
          {t('download')}
        </Button>
      </div>
      {manual && <p role="status">{t('manualSave')}</p>}
      <p className="text-sm text-muted-foreground">{t('storeSafely')}</p>
      <label className="flex items-start gap-2 leading-6">
        <Checkbox
          className="mt-1"
          checked={saved}
          disabled={pending}
          onCheckedChange={(value) => setSaved(value === true)}
        />
        <span>{t('savedCheckbox')}</span>
      </label>
      <MfaActions>
        <Button disabled={!saved || pending} onClick={onSaved}>
          {pending ? t('checking') : t(setup ? 'finishSetup' : 'codesSaved')}
        </Button>
      </MfaActions>
    </div>
  )
}
