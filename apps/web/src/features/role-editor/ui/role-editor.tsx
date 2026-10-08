'use client'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import type { CapabilityCatalogueResponse, RoleDefinitionDetail } from '@amcore/shared'

import type { useRoleDefinition } from '@/entities/organization-context'
import { ApiErrorAlert } from '@/shared/ui/api-error-alert'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { ConfirmDialog } from '@/shared/ui/confirm-dialog'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'

import { useRoleEditor } from '../model/use-role-editor'
import { useUnsavedGuard } from '../model/use-unsaved-guard'

import { AdvancedRules } from './advanced-rules'
import { CapabilityEditor } from './capability-editor'
import { DeleteRoleDialog } from './delete-role-dialog'
import { HoldersSummary } from './holders-summary'
import { SaveStatus } from './save-status'

type Step = 'fullControl' | 'selfHeld'

/** The editable role: details, capabilities, read-only advanced rules, impact and commands. */
export function RoleEditor({
  role,
  detail,
  capabilities,
  onDeleted,
  onLeave,
  onReview,
  holderHref,
}: {
  role: ReturnType<typeof useRoleDefinition>
  detail: RoleDefinitionDetail
  capabilities: CapabilityCatalogueResponse['capabilities']
  onDeleted: () => void
  onLeave: (href: string) => void
  onReview: () => void
  holderHref?: (email: string) => string
}) {
  const t = useTranslations('organizationRoles')
  const editor = useRoleEditor(role, detail, capabilities)
  const guard = useUnsavedGuard(editor.dirty)
  const editable = detail.editMode === 'editable'
  const steps = (['fullControl', 'selfHeld'] as const).filter((step) => editor.needs[step])
  const [step, setStep] = useState<number>()
  const current: Step | undefined = step === undefined ? undefined : steps[step]
  const startSave = () => (steps.length > 0 ? setStep(0) : void editor.save(editor.needs))
  const confirmed = () => {
    if (step !== undefined && step + 1 < steps.length) setStep(step + 1)
    else {
      setStep(undefined)
      void editor.save(editor.needs)
    }
  }
  return (
    <div className="space-y-6">
      <Panel>
        <h3 className="text-base font-semibold">{t('detailsTitle')}</h3>
        <div className="space-y-2">
          <Label htmlFor="role-name">{t('nameLabel')}</Label>
          <Input
            id="role-name"
            value={editor.draft.name}
            disabled={!editable || role.busy}
            onChange={(e) => editor.change({ name: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role-description">{t('descriptionLabel')}</Label>
          <Input
            id="role-description"
            value={editor.draft.description}
            disabled={!editable || role.busy}
            onChange={(e) => editor.change({ description: e.target.value })}
          />
        </div>
      </Panel>
      {detail.managedPresets !== null && (
        <Panel>
          <section aria-labelledby="role-capabilities-title" className="space-y-3">
            <h3 id="role-capabilities-title" className="text-base font-semibold">
              {t('capabilitiesTitle')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('capabilitiesHint')}</p>
            <CapabilityEditor
              capabilities={capabilities}
              keys={editor.draft.keys}
              disabled={!editable || role.busy}
              onToggle={editor.toggle}
            />
          </section>
        </Panel>
      )}
      {(detail.advancedRules?.length ?? 0) > 0 && (
        <Panel>
          <AdvancedRules rules={detail.advancedRules ?? []} />
        </Panel>
      )}
      <Panel>
        <HoldersSummary detail={detail} holderHref={holderHref} />
      </Panel>
      <Panel>
        <SaveStatus
          result={editor.result}
          stale={editor.stale}
          dirty={editor.dirty}
          onReview={() => {
            editor.discard()
            onReview()
          }}
        />
        {editor.result.kind === 'rejected' && <ApiErrorAlert error={editor.result.error} />}
        {editable && (
          <div className="flex flex-wrap gap-3">
            <Button disabled={!editor.dirty || role.busy} onClick={startSave}>
              {role.busy ? t('saving') : t('save')}
            </Button>
            <Button
              variant="outline"
              disabled={!editor.dirty || role.busy}
              onClick={editor.discard}
            >
              {t('discard')}
            </Button>
            <DeleteRoleDialog
              role={role}
              detail={detail}
              disabled={role.busy}
              onDeleted={onDeleted}
            />
          </div>
        )}
      </Panel>
      <ConfirmDialog
        open={current !== undefined}
        onOpenChange={(open) => !open && setStep(undefined)}
        title={current === 'selfHeld' ? t('selfHeldTitle') : t('fullControlTitle')}
        description={current === 'selfHeld' ? t('selfHeldBody') : t('fullControlBody')}
        confirmLabel={current === 'selfHeld' ? t('selfHeldConfirm') : t('fullControlConfirm')}
        cancelLabel={t('cancel')}
        onConfirm={confirmed}
      />
      <ConfirmDialog
        open={guard.held !== undefined}
        onOpenChange={(open) => !open && guard.release()}
        title={t('leaveTitle')}
        description={t('leaveBody')}
        confirmLabel={t('leaveConfirm')}
        cancelLabel={t('leaveStay')}
        onConfirm={() => {
          const href = guard.held
          guard.release()
          if (href) onLeave(href)
        }}
      />
    </div>
  )
}

/** Every section sits on a card so text stays readable on the page background. */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}
