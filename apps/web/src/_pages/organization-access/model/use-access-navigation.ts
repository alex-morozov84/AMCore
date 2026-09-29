'use client'

import { useEffect, useRef } from 'react'

import type {
  OrganizationContextData,
  OrganizationContextInput,
  OrganizationContextState,
} from '@/entities/organization-context'

import { organizationListNeedsRecovery } from './list-recovery'

import 'client-only'

function useReadyHeading(state: OrganizationContextState, selected: boolean) {
  const heading = useRef<HTMLHeadingElement>(null)
  const focusedTarget = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (state.status === 'ready' && selected && focusedTarget.current !== state.target) {
      focusedTarget.current = state.target
      heading.current?.focus({ preventScroll: true })
    }
  }, [selected, state.target, state.status])
  return heading
}

/** Page-owned navigation, bounded recovery and heading focus; no authority requests. */
export function useAccessNavigation({
  state,
  data,
  input,
  explicitList,
  refresh,
  onReplace,
  contextHref,
  pageHref,
}: {
  state: OrganizationContextState
  data: OrganizationContextData | undefined
  input: OrganizationContextInput
  explicitList: boolean
  refresh: () => void
  onReplace: (href: string) => void
  contextHref: (id: string) => string
  pageHref: (page: number) => string
}) {
  const recovered = useRef(false)
  const redirectedTarget = useRef<string | undefined>(undefined)
  const selected = input.kind === 'selected'
  const heading = useReadyHeading(state, selected)
  const list = data && 'total' in data.data ? data.data : undefined
  const context = data && 'organization' in data.data ? data.data : undefined
  const inconsistent = list ? organizationListNeedsRecovery(list) : false
  const autoOpen = !explicitList && list?.total === 1 && !inconsistent

  useEffect(() => {
    if (autoOpen && list) {
      const href = contextHref(list.data[0]!.id)
      if (redirectedTarget.current !== href) {
        redirectedTarget.current = href
        onReplace(href)
      }
    } else if (inconsistent && !recovered.current) {
      recovered.current = true
      if (input.kind === 'list' && input.page !== 1) onReplace(pageHref(1))
      else refresh()
    }
  }, [autoOpen, inconsistent, list, input, onReplace, contextHref, pageHref, refresh])

  return {
    heading,
    selected,
    list,
    context,
    inconsistent,
    autoOpen,
    refresh() {
      recovered.current = false
      refresh()
    },
  }
}
