import type { SupportedLocale } from '@amcore/shared'

import { invitationAcceptHandler } from '@/shared/api/bff/invitation-accept-handler'
import { invitationAckHandler } from '@/shared/api/bff/invitation-ack-handler'
import { invitationCredentialHandler } from '@/shared/api/bff/invitation-credential-handler'
import { invitationBootstrap, invitationIngress } from '@/shared/api/bff/invitation-ingress'
import { invitationOAuthReservation } from '@/shared/api/bff/invitation-oauth-reservation'
import { invitationOperationHandler } from '@/shared/api/bff/invitation-operation-handler'
import { invitationReadHandler } from '@/shared/api/bff/invitation-read-handler'
import { invitationSwitchHandler } from '@/shared/api/bff/invitation-switch-handler'
import { invitationVerificationHandler } from '@/shared/api/bff/invitation-verification-handler'
import { invitationVerificationReturn, invitationVerificationReturnLink } from '@/shared/api/bff/invitation-verification-return'
import { productContextDeps } from '@/shared/api/bff/product-context-deps'

import 'server-only'

/** Application wiring; thin Next route adapters only provide their code-owned action and params. */
export const invitationHandlers = {
  context: (request: Request, id: string) => invitationReadHandler(request, id, 'context', productContextDeps(request.headers)),
  inspect: (request: Request, id: string) => invitationReadHandler(request, id, 'inspect', productContextDeps(request.headers)),
  login: (request: Request, id: string) => invitationCredentialHandler(request, id, 'login', productContextDeps(request.headers)),
  register: (request: Request, id: string) => invitationCredentialHandler(request, id, 'register', productContextDeps(request.headers)),
  accept: (request: Request, id: string) => invitationAcceptHandler(request, id, productContextDeps(request.headers)),
  verification: (request: Request, id: string) => invitationVerificationHandler(request, id, productContextDeps(request.headers)),
  verificationLink: (request: Request, id: string) => invitationVerificationReturnLink(request, id, productContextDeps(request.headers)),
  verificationReturn: (request: Request, id: string) => invitationVerificationReturn(request, id, productContextDeps(request.headers)),
  switchAccount: (request: Request, id: string) => invitationSwitchHandler(request, id, productContextDeps(request.headers)),
  oauth: (request: Request, id: string, provider: string) => invitationOAuthReservation(request, id, provider, productContextDeps(request.headers)),
  acknowledge: (request: Request, id: string, attemptId: string) => invitationAckHandler(request, id, attemptId, productContextDeps(request.headers)),
  operation: (request: Request, operationId: string) => invitationOperationHandler(request, operationId, productContextDeps(request.headers)),
  ingress: (request: Request, locale: SupportedLocale) => invitationIngress(request, locale, productContextDeps(request.headers)),
  bootstrap: (request: Request, locale: SupportedLocale, pendingId: string) => invitationBootstrap(request, locale, pendingId, productContextDeps(request.headers)),
}
