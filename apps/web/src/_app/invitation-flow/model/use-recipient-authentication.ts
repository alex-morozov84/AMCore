import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AuthErrorCode, type InvitationFlowBinding, type UserResponse } from '@amcore/shared'
import { useQueryClient } from '@tanstack/react-query'

import { invitationFlowClient } from '@/entities/invitation-flow'
import { userKeys } from '@/entities/user'
import { ClientErrorCode, ClientStateError } from '@/shared/api/error-codes'
import { getErrorCode } from '@/shared/api/errors'

import { createInvitationCredentialAdapters } from './credential-adapters'

type Phase = 'active' | 'authenticating' | 'completing_signin' | 'retired' | 'unusable'
const changed = () => new ClientStateError(ClientErrorCode.AUTH_CONTINUATION_CHANGED)

/** Application auth/cache wiring; credentials and headless presentation remain separate boundaries. */
export function useRecipientAuthentication(
  initial: InvitationFlowBinding,
  initialUser: UserResponse | null
) {
  const [binding, setBinding] = useState(initial)
  const [user, setUser] = useState(initialUser)
  const [phase, setPhase] = useState<Phase>('active')
  const [handoff, setHandoff] = useState<string | null>(null)
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const lifecycle = useRef({ active: true, epoch: 0 })
  const client = useQueryClient()
  useEffect(() => {
    lifecycle.current.active = true
    return () => {
      lifecycle.current.active = false
      lifecycle.current.epoch++
    }
  }, [])
  const confirmed = (next: InvitationFlowBinding, account: UserResponse) => {
    setBinding(next)
    setUser(account)
    setPhase('active')
    setHandoff(null)
    setError(undefined)
    client.setQueryData(userKeys.me(), { user: account })
    lifecycle.current.epoch++
  }
  const adapters = useMemo(() => {
    let captured: number | undefined
    return createInvitationCredentialAdapters({
      binding,
      isCurrent: () =>
        lifecycle.current.active &&
        (captured === undefined || lifecycle.current.epoch === captured),
      onStart: () => {
        captured = lifecycle.current.epoch
        setPhase('authenticating')
        setError(undefined)
      },
      onHandoff: (next, attemptId) => {
        setBinding(next)
        setHandoff(attemptId)
        setPhase('completing_signin')
      },
      onConfirmed: (next, account) => {
        setUser(account)
        setBinding(next)
        setPhase('active')
        setHandoff(null)
        setError(undefined)
        lifecycle.current.epoch++
      },
      async onFailure(failure) {
        setError(failure)
        const code = getErrorCode(failure)
        if (code !== AuthErrorCode.INVALID_CREDENTIALS && code !== AuthErrorCode.RATE_LIMIT_EXCEEDED)
          return
        // Rejection advances the server revision. Read its authoritative binding before retrying.
        try {
          const current = await invitationFlowClient.context(binding.flowId, AbortSignal.timeout(10000))
          if (!lifecycle.current.active || lifecycle.current.epoch !== captured) return
          if ('state' in current || current.binding.flowId !== binding.flowId ||
            current.binding.sessionBinding !== binding.sessionBinding) return
          setBinding(current.binding)
          setPhase('active')
          setHandoff(null)
        } catch {
          // Failed synchronization still needs explicit recovery; never replay credentials.
        }
      },
    })
  }, [binding])
  async function recover() {
    if (busy || !lifecycle.current.active) return
    const captured = lifecycle.current.epoch
    setBusy(true)
    setError(undefined)
    try {
      const response = handoff
        ? await invitationFlowClient.acknowledge(binding, handoff, AbortSignal.timeout(15000))
        : await invitationFlowClient.context(binding.flowId, AbortSignal.timeout(10000))
      if (!lifecycle.current.active || lifecycle.current.epoch !== captured) return
      if (response.binding.flowId !== initial.flowId) throw changed()
      if (
        handoff &&
        (!('handoff' in response) ||
          response.handoff.attemptId !== handoff ||
          response.binding.flowRevision !== binding.flowRevision ||
          response.binding.sessionBinding !== binding.sessionBinding)
      )
        throw changed()
      if ('state' in response) {
        setBinding(response.binding)
        setPhase(response.state)
        setHandoff(response.state === 'completing_signin' ? response.handoff.attemptId : null)
        return
      }
      if ('user' in response.data) {
        confirmed(response.binding, response.data.user)
        return
      }
      if (response.binding.sessionBinding === null) {
        setBinding(response.binding)
        setUser(null)
        setPhase('active')
        setHandoff(null)
        lifecycle.current.epoch++
      } else {
        const profile = await invitationFlowClient.verificationStatus(
          response.binding,
          AbortSignal.timeout(10000)
        )
        if (!lifecycle.current.active || lifecycle.current.epoch !== captured) return
        confirmed(profile.binding, profile.data.user)
      }
    } catch (failure) {
      if (lifecycle.current.active && lifecycle.current.epoch === captured) {
        const code = getErrorCode(failure)
        if (code === 'INVITE_INVALID_OR_EXPIRED' || code === 'INVITE_FLOW_CHANGED') {
          lifecycle.current.epoch++
          setUser(null)
          setHandoff(null)
          setPhase(code === 'INVITE_INVALID_OR_EXPIRED' ? 'unusable' : 'retired')
        } else setError(failure)
      }
    } finally {
      if (lifecycle.current.active) setBusy(false)
    }
  }
  const observePending = useCallback(
    (
      next: InvitationFlowBinding,
      state: 'authenticating' | 'completing_signin',
      attemptId?: string
    ) => {
      setBinding(next)
      setPhase(state)
      setHandoff(attemptId ?? null)
    },
    []
  )
  const retire = useCallback(() => {
    lifecycle.current.active = false
    lifecycle.current.epoch++
    setPhase('retired')
    setUser(null)
    setHandoff(null)
  }, [])
  return {
    binding,
    user,
    phase,
    handoff,
    error,
    busy,
    adapters,
    recover,
    observePending,
    retire,
    capture: () => lifecycle.current.epoch,
    current: (captured: number) => lifecycle.current.active && lifecycle.current.epoch === captured,
    updateUser(account: UserResponse) {
      setUser(account)
      client.setQueryData(userKeys.me(), { user: account })
    },
    signedOut(next: InvitationFlowBinding) {
      lifecycle.current.epoch++
      setBinding(next)
      setUser(null)
      setPhase('active')
      setHandoff(null)
      setError(undefined)
      client.setQueryData(userKeys.me(), { user: null })
    },
  }
}
