import { type Dispatch, type SetStateAction, useCallback, useState } from 'react'

export interface DebounceSchedule {
  revision: number
  armed: boolean
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
  pendingIdentity: string | null
  setValue: Setter<string>
  setSyncedIdentity: Setter<string>
  setLastCommitIdentity: Setter<string>
  setPendingIdentity: Setter<string | null>
  setSchedule: Setter<DebounceSchedule>
}

function reconcileAuthority(options: ReconcileOptions) {
  const { authoritativeIdentity, syncedIdentity, pendingIdentity } = options
  if (authoritativeIdentity === syncedIdentity) return
  options.setSyncedIdentity(authoritativeIdentity)
  if (pendingIdentity === authoritativeIdentity) {
    options.setPendingIdentity(null)
    return
  }
  options.setPendingIdentity(null)
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
  const [pendingIdentity, setPendingIdentity] = useState<string | null>(null)
  const [schedule, setSchedule] = useState<DebounceSchedule>({ revision: 0, armed: false })
  reconcileAuthority({
    authoritativeValue,
    authoritativeIdentity,
    syncedIdentity,
    pendingIdentity,
    setValue,
    setSyncedIdentity,
    setLastCommitIdentity,
    setPendingIdentity,
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
    setPendingIdentity,
  }
}
