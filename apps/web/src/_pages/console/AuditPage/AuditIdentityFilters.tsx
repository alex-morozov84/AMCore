'use client'

import { useState } from 'react'

import { ConsoleFilterDisclosure } from '@/shared/ui/console-detail/ConsoleFilterDisclosure'
import { FilterButtons } from '@/shared/ui/filter-buttons'
import { Input } from '@/shared/ui/input'

import type { AuditCopy } from './audit-copy'
import { AuditLookup } from './AuditLookup'

type Identity = 'actorId' | 'targetId' | 'organizationId'

export function AuditIdentityFilters({
  actorId,
  targetId,
  organizationId,
  copy,
  onChange,
  onSelect,
}: {
  actorId: string
  targetId: string
  organizationId: string
  copy: AuditCopy
  onChange: (key: Identity, value: string) => void
  onSelect: (key: Identity, id: string) => void
}) {
  const [advancedOpen, setAdvancedOpen] = useState(!!(actorId || targetId || organizationId))
  const [destination, setDestination] = useState<'actorId' | 'targetId'>('actorId')
  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{copy.userDestination}:</span>
          <FilterButtons<'actorId' | 'targetId'>
            label={copy.userDestination}
            value={destination}
            options={(['actorId', 'targetId'] as const).map((kind) => ({
              value: kind,
              label: kind === 'actorId' ? copy.actor : copy.target,
            }))}
            onChange={setDestination}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <AuditLookup kind="user" copy={copy} onSelect={(id) => onSelect(destination, id)} />
          <AuditLookup
            kind="organization"
            copy={copy}
            onSelect={(id) => onSelect('organizationId', id)}
          />
        </div>
      </div>
      <ConsoleFilterDisclosure
        label={copy.advancedIds}
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              [copy.actorId, actorId, (value: string) => onChange('actorId', value)],
              [copy.targetId, targetId, (value: string) => onChange('targetId', value)],
              [
                copy.organizationId,
                organizationId,
                (value: string) => onChange('organizationId', value),
              ],
            ] as const
          ).map(([label, value, setter]) => (
            <label key={label} className="grid gap-2 text-sm font-medium">
              {label}
              <Input
                value={value}
                onChange={(event) => setter(event.target.value)}
                maxLength={128}
                className="bg-background"
              />
            </label>
          ))}
        </div>
      </ConsoleFilterDisclosure>
    </>
  )
}
