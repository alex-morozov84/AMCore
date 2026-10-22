import type { SupportedLocale } from '@amcore/shared'

import type { ContextExecutorDeps } from '@/shared/api/bff/context-executor'
import { invitationAcceptHandler } from '@/shared/api/bff/invitation-accept-handler'
import { invitationAckHandler } from '@/shared/api/bff/invitation-ack-handler'
import { invitationContextDeps } from '@/shared/api/bff/invitation-context-deps'
import { invitationCredentialHandler } from '@/shared/api/bff/invitation-credential-handler'
import { invitationBootstrap, invitationIngress } from '@/shared/api/bff/invitation-ingress'
import { invitationOAuthReservation } from '@/shared/api/bff/invitation-oauth-reservation'
import { invitationOperationHandler } from '@/shared/api/bff/invitation-operation-handler'
import { invitationReadHandler } from '@/shared/api/bff/invitation-read-handler'
import { invitationSwitchHandler } from '@/shared/api/bff/invitation-switch-handler'
import { invitationVerificationHandler } from '@/shared/api/bff/invitation-verification-handler'
import {
  invitationVerificationReturn,
  invitationVerificationReturnLink,
} from '@/shared/api/bff/invitation-verification-return'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'
import { productWebRoute } from '@/shared/api/bff/product-web-route'

import 'server-only'

function flowRequest(
  request: Request,
  id: string,
  work: (deps: ContextExecutorDeps) => Promise<Response>,
  verification = false
) {
  return productWebRoute(request, 'product-data', async () => {
    const deps = await invitationContextDeps(
      request,
      verification ? { verificationId: id } : { flowId: id }
    )
    return work(deps)
  })
}

/** Application wiring; route adapters supply code-owned action and identifiers only. */
export const invitationHandlers = {
  context: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationReadHandler(request, id, 'context', deps)),
  inspect: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationReadHandler(request, id, 'inspect', deps)),
  login: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationCredentialHandler(request, id, 'login', deps)),
  register: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationCredentialHandler(request, id, 'register', deps)),
  accept: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationAcceptHandler(request, id, deps)),
  verification: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationVerificationHandler(request, id, deps)),
  verificationLink: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationVerificationReturnLink(request, id, deps)),
  verificationReturn: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationVerificationReturn(request, id, deps), true),
  switchAccount: (request: Request, id: string) =>
    flowRequest(request, id, (deps) => invitationSwitchHandler(request, id, deps)),
  oauth: (request: Request, id: string, provider: string) =>
    flowRequest(request, id, (deps) => invitationOAuthReservation(request, id, provider, deps)),
  acknowledge: (request: Request, id: string, attemptId: string) =>
    flowRequest(request, id, (deps) => invitationAckHandler(request, id, attemptId, deps)),
  operation: (request: Request, operationId: string) =>
    productWebRoute(request, 'product-data', () =>
      invitationOperationHandler(request, operationId, productContextDeps(request.headers))
    ),
  ingress: (request: Request, locale: SupportedLocale) =>
    productWebRoute(request, 'legacy-invite', () =>
      invitationIngress(request, locale, productContextDeps(request.headers, 'legacy-invite'))
    ),
  bootstrap: (request: Request, locale: SupportedLocale, pendingId: string) =>
    productWebRoute(request, 'legacy-invite', () =>
      invitationBootstrap(
        request,
        locale,
        pendingId,
        productContextDeps(request.headers, 'legacy-invite')
      )
    ),
  adminIngress: (request: Request, locale: SupportedLocale) =>
    productWebRoute(request, 'admin-invite', () =>
      invitationIngress(request, locale, productContextDeps(request.headers, 'admin-invite'))
    ),
  adminBootstrap: (request: Request, locale: SupportedLocale, pendingId: string) =>
    productWebRoute(request, 'admin-invite', () =>
      invitationBootstrap(
        request,
        locale,
        pendingId,
        productContextDeps(request.headers, 'admin-invite')
      )
    ),
}
