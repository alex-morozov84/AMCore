import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'

export interface DebounceSchedule {
  revision: number
  armed: boolean
}

function consume(counts: ReadonlyMap<string, number>, key: string) {
  const next = new Map(counts)
  const remaining = (next.get(key) ?? 0) - 1
  if (remaining > 0) next.set(key, remaining)
  else next.delete(key)
  return next
}

const nextSchedule = (current: DebounceSchedule, armed: boolean) => ({
  revision: current.revision + 1,
  armed,
})

type Setter<T> = Dispatch<SetStateAction<T>>

interface ReconcileOptions {
  authoritativeValue: string
  authoritativeIdentity: string
  syncedIdentity: string
  pending: ReadonlyMap<string, number>
  setValue: Setter<string>
  setSyncedIdentity: Setter<string>
  setLastCommitIdentity: Setter<string>
  setPending: Setter<ReadonlyMap<string, number>>
  setSchedule: Setter<DebounceSchedule>
}

function reconcileAuthority(options: ReconcileOptions) {
  const { authoritativeIdentity, syncedIdentity, pending } = options
  if (authoritativeIdentity === syncedIdentity) return
  options.setSyncedIdentity(authoritativeIdentity)
  if ((pending.get(authoritativeIdentity) ?? 0) > 0) {
    options.setPending(consume(pending, authoritativeIdentity))
    return
  }
  options.setValue(options.authoritativeValue)
  options.setLastCommitIdentity(authoritativeIdentity)
  options.setSchedule((current) => nextSchedule(current, false))
}

function useDraftActions(
  setValue: Setter<string>,
  setLastCommitIdentity: Setter<string>,
  setSchedule: Setter<DebounceSchedule>
) {
  const editValue = useCallback(
    (value: string) => {
      setValue(value)
      setSchedule((current) => nextSchedule(current, true))
    },
    [setSchedule, setValue]
  )
  const resetDraft = useCallback(
    (value: string, identity: string) => {
      setValue(value)
      setLastCommitIdentity(identity)
      setSchedule((current) => nextSchedule(current, false))
    },
    [setLastCommitIdentity, setSchedule, setValue]
  )
  const cancelDebounce = useCallback(() => {
    setSchedule((current) => nextSchedule(current, false))
  }, [setSchedule])
  return { editValue, resetDraft, cancelDebounce }
}

export function useDraftState(authoritativeValue: string, authoritativeIdentity: string) {
  const [value, setValue] = useState(authoritativeValue)
  const [syncedIdentity, setSyncedIdentity] = useState(authoritativeIdentity)
  const [lastCommitIdentity, setLastCommitIdentity] = useState(authoritativeIdentity)
  const [pending, setPending] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [schedule, setSchedule] = useState<DebounceSchedule>({ revision: 0, armed: false })
  reconcileAuthority({
    authoritativeValue,
    authoritativeIdentity,
    syncedIdentity,
    pending,
    setValue,
    setSyncedIdentity,
    setLastCommitIdentity,
    setPending,
    setSchedule,
  })
  const actions = useDraftActions(setValue, setLastCommitIdentity, setSchedule)

  return {
    value,
    setValue: actions.editValue,
    schedule,
    resetDraft: actions.resetDraft,
    cancelDebounce: actions.cancelDebounce,
    lastCommitIdentity,
    setLastCommitIdentity,
    setPending,
  }
}
