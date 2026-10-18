'use client'

import { useState } from 'react'

import type { OrganizationAccessController } from '@/entities/organization-context'

import { MemberApiKeysDialog, type MemberKeyTarget } from './member-api-keys-dialog'
import type { MemberKeyNotice } from './member-key-result'

/** Widget keeps this host mounted when overlays close, preserving uncertain outcomes. */
export function MemberApiKeysHost({
  controller,
  target,
  open,
  onClose,
}: {
  controller: OrganizationAccessController
  target?: MemberKeyTarget
  open: boolean
  onClose: () => void
}) {
  const [notices, setNotices] = useState<Record<string, MemberKeyNotice>>({})
  if (!target) return null
  const identity = JSON.stringify([
    controller.binding,
    controller.organizationId,
    target.userId,
    target.memberId,
  ])
  return (
    <MemberApiKeysDialog
      key={identity}
      controller={controller}
      target={target}
      open={open}
      onClose={onClose}
      notice={notices[identity]}
      onNotice={(value) => setNotices((previous) => ({ ...previous, [identity]: value }))}
    />
  )
}
