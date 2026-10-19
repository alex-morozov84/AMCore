import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { OwnKeyOrganizationsQuery } from '@amcore/shared'
import type { ApiKeyQuery, OwnApiKeyAdmission } from '@amcore/shared'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { OwnApiKeyController } from './own-api-key-controller'
import { observeOwnKeySession } from './session-lifecycle'

import 'client-only'

export function useOwnApiKeyController(admission: OwnApiKeyAdmission, target?: string) {
  const client = useQueryClient()
  const controller = useMemo(
    () => new OwnApiKeyController(admission),
    [admission.binding, admission.actorId]
  )
  const attempt = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot
  )
  const session = useSyncExternalStore(
    controller.session.subscribe,
    controller.session.getSnapshot,
    () => 'unverified' as const
  )
  useEffect(() => {
    controller.setTarget(target)
    void controller.session.freshCheck()
  }, [controller, target])
  useEffect(
    () => observeOwnKeySession(controller.session, controller.active, controller.discard),
    [controller]
  )
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: ['own-api-keys', admission.binding] })
      client.removeQueries({ queryKey: ['own-api-keys', admission.binding] })
      client.removeQueries({ queryKey: ['own-api-key-organizations', admission.binding] })
    },
    [client, admission.binding]
  )
  useEffect(() => {
    if (session === 'retired') {
      client.removeQueries({ queryKey: ['own-api-keys', admission.binding] })
      client.removeQueries({ queryKey: ['own-api-key-organizations', admission.binding] })
    }
  }, [session, client, admission.binding])
  return { controller, attempt, session }
}
export function useOwnApiKeys(controller: OwnApiKeyController, query: ApiKeyQuery, enabled = true) {
  return useQuery({
    queryKey: ['own-api-keys', controller.admission.binding, query],
    queryFn: ({ signal }) => controller.list(query, signal),
    retry: false,
    enabled: enabled && controller.session.getSnapshot() !== 'retired',
  })
}
/** Commands deliberately bypass MutationCache: the create result contains a one-time secret. */
export const useCreateOwnApiKey =
  (controller: OwnApiKeyController) => (input: Parameters<OwnApiKeyController['create']>[0]) =>
    controller.create(input)
export const useRevokeOwnApiKey =
  (controller: OwnApiKeyController) =>
  (...args: Parameters<OwnApiKeyController['revoke']>) =>
    controller.revoke(...args)

/** Plaintext projection for the active local result only; never place it in a shared journal/cache. */
export function useOwnApiKeySecret(controller: OwnApiKeyController, target?: string) {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.secretForDisplay(target),
    () => undefined
  )
}

export function useOwnKeyOrganizations(
  controller: OwnApiKeyController,
  query: OwnKeyOrganizationsQuery,
  enabled = true
) {
  return useQuery({
    queryKey: ['own-api-key-organizations', controller.admission.binding, query],
    queryFn: ({ signal }) => controller.organizations(query, signal),
    retry: false,
    enabled: enabled && controller.session.getSnapshot() !== 'retired',
  })
}

/** Safe command receipt; independent of rendered rows and list refresh. */
export function useOwnKeyRevocation(controller: OwnApiKeyController) {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getRevocationSnapshot,
    controller.getRevocationSnapshot
  )
}
