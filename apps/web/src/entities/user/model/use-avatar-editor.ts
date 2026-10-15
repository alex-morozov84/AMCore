'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserResponse } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { authApi } from '@/shared/api'
import { ApiRequestError } from '@/shared/api/http-client'

import { useCurrentUser, userKeys } from '../api/user-queries'

/** What the server accepts for an avatar (`AVATAR_VALIDATION`); checked here only as a convenience. */
export const AVATAR_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const

export type AvatarRejection = 'too_large' | 'invalid_type' | 'other'

/**
 * How one avatar action ended. `committed`: the server stored it. `rejected`: the server (or the
 * pre-check) refused it, nothing changed. `busy`: another avatar change is in progress, retry
 * shortly. `unknown`: the request may or may not have reached the server (network loss, 5xx), so
 * read the user again before trusting the avatar and never retry blindly. `retired`: the signed-in
 * user changed while the request was in flight, so the result was dropped.
 */
export type AvatarOutcome =
  | { kind: 'committed'; avatarUrl: string | null }
  | { kind: 'rejected'; reason: AvatarRejection; error: unknown }
  | { kind: 'busy'; error?: unknown }
  | { kind: 'unknown'; error: unknown }
  | { kind: 'retired' }

export interface AvatarEditorState {
  status: 'idle' | 'pending' | 'error'
  action: 'upload' | 'remove' | null
  /** The last failed attempt's error, for `ApiErrorAlert`; `null` otherwise. */
  error: unknown
  /** The last finished attempt of the current identity; `null` after `reset()` or an identity change. */
  outcome: AvatarOutcome | null
}

const IDLE: AvatarEditorState = { status: 'idle', action: null, error: null, outcome: null }

function precheck(file: File): AvatarOutcome | null {
  if (file.size > AVATAR_LIMITS.maxBytes)
    return { kind: 'rejected', reason: 'too_large', error: new Error('avatar too large') }
  if (!(AVATAR_LIMITS.mimeTypes as readonly string[]).includes(file.type))
    return { kind: 'rejected', reason: 'invalid_type', error: new Error('avatar type') }
  return null
}

/** Sort a failed request into an outcome by HTTP status, never by message text. */
function classify(error: unknown): AvatarOutcome {
  if (error instanceof ApiRequestError) {
    if (error.status === 413) return { kind: 'rejected', reason: 'too_large', error }
    if (error.status === 503 || error.status === 429) return { kind: 'busy', error }
    if (error.status === 400 || error.status === 415 || error.status === 422)
      return { kind: 'rejected', reason: 'invalid_type', error }
    if (error.status >= 400 && error.status < 500)
      return { kind: 'rejected', reason: 'other', error }
  }
  return { kind: 'unknown', error }
}

function mergeAvatarUrl(
  setData: (updater: (old: { user: UserResponse | null } | undefined) => unknown) => void,
  userId: string,
  avatarUrl: string | null
): void {
  setData((old) => (old?.user?.id === userId ? { user: { ...old.user, avatarUrl } } : old))
}

/**
 * Headless avatar editing for the signed-in user: pending, structured error and outcome state, no
 * redirect, toast or navigation. Any UI (the ready `AvatarEditor` or a custom one) shares these
 * operations. A result that arrives after the signed-in user changed is dropped (`retired`):
 * it never touches state or the cached user of the new identity.
 */
export function useAvatarEditor() {
  const queryClient = useQueryClient()
  const { data } = useCurrentUser()
  const user = data?.user ?? null
  const currentId = useRef<string | null>(user?.id ?? null)
  const inFlight = useRef(false)
  const [state, setState] = useState<AvatarEditorState>(IDLE)

  useEffect(() => {
    currentId.current = user?.id ?? null
    setState(IDLE)
  }, [user?.id])

  const run = useCallback(
    async (action: 'upload' | 'remove', send: () => Promise<string | null>) => {
      const userId = currentId.current
      if (!userId) return { kind: 'retired' } as AvatarOutcome
      if (inFlight.current) return { kind: 'busy' } as AvatarOutcome
      inFlight.current = true
      setState({ status: 'pending', action, error: null, outcome: null })
      let outcome: AvatarOutcome
      try {
        const avatarUrl = await send()
        outcome = { kind: 'committed', avatarUrl }
      } catch (error) {
        outcome = classify(error)
      } finally {
        inFlight.current = false
      }
      if (currentId.current !== userId) return { kind: 'retired' } as AvatarOutcome
      // The request may or may not have reached the server: read the user again so the shown
      // avatar is the real one. Never for rejected or busy (nothing changed) or retired.
      if (outcome.kind === 'unknown')
        void queryClient.invalidateQueries({ queryKey: userKeys.me() })
      if (outcome.kind === 'committed') {
        mergeAvatarUrl(
          (updater) => queryClient.setQueryData(userKeys.me(), updater),
          userId,
          outcome.avatarUrl
        )
        setState({ status: 'idle', action, error: null, outcome })
      } else {
        const error = 'error' in outcome ? outcome.error : null
        setState({ status: 'error', action, error, outcome })
      }
      return outcome
    },
    [queryClient]
  )

  const upload = useCallback(
    (file: File): Promise<AvatarOutcome> => {
      const refused = precheck(file)
      if (refused) {
        setState({
          status: 'error',
          action: 'upload',
          error: 'error' in refused ? refused.error : null,
          outcome: refused,
        })
        return Promise.resolve(refused)
      }
      return run('upload', async () => (await authApi.uploadAvatar(file)).avatarUrl)
    },
    [run]
  )

  const remove = useCallback(
    (): Promise<AvatarOutcome> =>
      run('remove', async () => {
        await authApi.deleteAvatar()
        return null
      }),
    [run]
  )

  const reset = useCallback(() => setState(IDLE), [])

  return {
    user,
    avatarUrl: user?.avatarUrl ?? null,
    ...state,
    isPending: state.status === 'pending',
    upload,
    remove,
    reset,
  }
}
