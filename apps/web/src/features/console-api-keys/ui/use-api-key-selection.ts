'use client'

import { useEffect, useRef, useState } from 'react'
import type { AdminApiKey, AdminApiKeyListResponse } from '@amcore/shared'

import 'client-only'

export function useApiKeySelection(response: AdminApiKeyListResponse, identity: string) {
  const [selected, setSelected] = useState<string[]>([])
  const [targets, setTargets] = useState<AdminApiKey[] | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)
  const previousIdentity = useRef(identity)
  useEffect(() => {
    if (busy || targets || !restoreFocus.current) return
    const frame = requestAnimationFrame(() => {
      refresh.current?.focus()
      restoreFocus.current = false
    })
    return () => cancelAnimationFrame(frame)
  }, [busy, targets])
  useEffect(() => {
    const eligible = new Set(
      response.data.filter((row) => row.status !== 'revoked').map((row) => row.id)
    )
    setSelected((ids) =>
      previousIdentity.current !== identity ? [] : ids.filter((id) => eligible.has(id))
    )
    previousIdentity.current = identity
  }, [identity, response.data])
  const eligible = response.data.filter((row) => row.status !== 'revoked')
  const checked = new Set(selected)
  const toggle = (id: string) =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]))
  function pick(rows: AdminApiKey[]) {
    if (!busy && rows.length) {
      setTargets(rows)
      setBusy(true)
    }
  }
  function success() {
    restoreFocus.current = true
    setSelected([])
    setTargets(null)
    setBusy(false)
  }
  function close() {
    restoreFocus.current = true
    setTargets(null)
    setBusy(false)
  }
  return {
    selected,
    targets,
    busy,
    refresh,
    eligible,
    checked,
    toggle,
    pick,
    success,
    close,
    setBusy,
    setSelected,
  }
}
