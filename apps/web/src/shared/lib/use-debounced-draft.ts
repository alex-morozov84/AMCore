'use client'

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from 'react'

import { type DebounceSchedule, useDraftState } from './debounced-draft-state'

const identity = (value: string) => value

export interface UseDebouncedDraftOptions {
  authoritativeValue: string
  authoritativeIdentity?: string
  getCommitIdentity?: (value: string) => string
  delayMs: number
  normalize?: (value: string) => string
  onCommit: (value: string) => void
}

function increment(counts: ReadonlyMap<string, number>, key: string) {
  const next = new Map(counts)
  next.set(key, (next.get(key) ?? 0) + 1)
  return next
}

function useDebounceTimer(
  value: string,
  schedule: DebounceSchedule,
  delayMs: number,
  disarm: () => void,
  commit: (value: string) => void
) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const commitFromEffect = useEffectEvent(commit)

  useEffect(() => {
    if (!schedule.armed) return
    timerRef.current = setTimeout(() => {
      disarm()
      commitFromEffect(value)
    }, delayMs)
    return () => clearTimeout(timerRef.current)
  }, [delayMs, disarm, schedule, value])

  return timerRef
}

function useDraftCommit(
  options: Pick<UseDebouncedDraftOptions, 'getCommitIdentity' | 'normalize' | 'onCommit'>,
  lastCommitIdentity: string,
  setLastCommitIdentity: (identity: string) => void,
  setPending: Dispatch<SetStateAction<ReadonlyMap<string, number>>>
) {
  const { getCommitIdentity = identity, normalize = identity, onCommit } = options
  return useCallback(
    (draft: string) => {
      const canonical = normalize(draft)
      const commitIdentity = getCommitIdentity(canonical)
      if (commitIdentity === lastCommitIdentity) return
      setLastCommitIdentity(commitIdentity)
      setPending((current) => increment(current, commitIdentity))
      onCommit(canonical)
    },
    [getCommitIdentity, lastCommitIdentity, normalize, onCommit, setLastCommitIdentity, setPending]
  )
}

function useImmediateDraftActions(
  commit: (value: string) => void,
  timerRef: RefObject<ReturnType<typeof setTimeout> | undefined>,
  authoritativeValue: string,
  authoritativeIdentity: string,
  cancelDebounce: () => void,
  resetDraft: (value: string, identity: string) => void
) {
  const commitNow = useCallback(
    (draft: string) => {
      clearTimeout(timerRef.current)
      cancelDebounce()
      commit(draft)
    },
    [cancelDebounce, commit, timerRef]
  )
  const discardDraft = useCallback(() => {
    clearTimeout(timerRef.current)
    resetDraft(authoritativeValue, authoritativeIdentity)
  }, [authoritativeIdentity, authoritativeValue, resetDraft, timerRef])
  return { commitNow, discardDraft }
}

/** Coordinates a temporary string draft with canonical state supplied by its caller. */
export function useDebouncedDraft({
  authoritativeValue,
  authoritativeIdentity = authoritativeValue,
  getCommitIdentity,
  delayMs,
  normalize,
  onCommit,
}: UseDebouncedDraftOptions) {
  const state = useDraftState(authoritativeValue, authoritativeIdentity)
  const { value, setValue, schedule, lastCommitIdentity, setLastCommitIdentity, setPending } = state
  const commit = useDraftCommit(
    { getCommitIdentity, normalize, onCommit },
    lastCommitIdentity,
    setLastCommitIdentity,
    setPending
  )
  const timerRef = useDebounceTimer(value, schedule, delayMs, state.cancelDebounce, commit)
  const actions = useImmediateDraftActions(
    commit,
    timerRef,
    authoritativeValue,
    authoritativeIdentity,
    state.cancelDebounce,
    state.resetDraft
  )

  return { value, setValue, ...actions }
}
