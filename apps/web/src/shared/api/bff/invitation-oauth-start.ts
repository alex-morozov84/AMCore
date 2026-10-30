import {
  BROWSER_AUTH_HEADERS,
  invitationFlowIdSchema,
  invitationOAuthCorrelationSchema,
} from '@amcore/shared'

import {
  browserAnchorCookie,
  privateBrowserHeaders,
  readBrowserAnchor,
} from './browser-binding.server'
import { prepareBrowserAuthAttempt } from './browser-bootstrap-handler'
import { withinContextDeadline } from './context-deadline'
import { invitationFlowChanged } from './invitation-flow-authority'
import { invitationOAuthFlow } from './invitation-oauth-carrier'
import { readInvitationOAuthCarrier, startInvitationOAuthCarrier } from './invitation-oauth-store'
import { withInvitationOwnerLease } from './invitation-owner-lease'
import { captureInvitationRequest } from './invitation-request-snapshot'
import { productContextDeps } from './product-context-deps'
import type { ProductWebContext } from './product-web-context.server'

import 'server-only'

/** Only a server-reserved carrier can attach continuation authority to provider initiation. */
export async function startInvitedOAuth(
  request: Request,
  provider: string,
  attemptId: string,
  send: (headers: Headers, signal: AbortSignal) => Promise<Response>,
  context?: ProductWebContext
) {
  const id = invitationFlowIdSchema.parse(attemptId)
  const allowed = invitationOAuthCorrelationSchema.shape.provider.parse(provider)
  const carrier = await readInvitationOAuthCarrier(id, context)
  if (!carrier || carrier.provider !== allowed) throw invitationFlowChanged()
  return withinContextDeadline(
    request.signal,
    (signal) =>
      withInvitationOwnerLease(
        carrier.ownerHash,
        signal,
        async () => {
          const snapshot = await captureInvitationRequest(
            request,
            carrier.flowId,
            productContextDeps(
              request.headers,
              context?.frontend === 'admin' ? 'admin-invite' : 'legacy-invite'
            )
          )
          const flow = invitationOAuthFlow(
            snapshot.owner,
            carrier,
            snapshot.ownerHash,
            snapshot.session?.binding ?? null,
            Date.now()
          )
          if (
            carrier.status !== 'reserved' ||
            carrier.createdAt + 60000 <= Date.now() ||
            !flow.attempt
          )
            throw invitationFlowChanged()
          const next = {
            ...snapshot.owner,
            flows: snapshot.owner.flows.map((candidate) =>
              candidate.binding.flowId === carrier.flowId
                ? { ...candidate, attempt: { ...flow.attempt!, started: true } }
                : candidate
            ),
          }
          signal.throwIfAborted()
          if (
            !(await startInvitationOAuthCarrier(
              snapshot.ownerHash,
              snapshot.owner.version,
              next,
              carrier,
              context
            ))
          )
            throw invitationFlowChanged()
          const headers = new Headers({
            'x-invitation-continuation': flow.credential,
            'x-invitation-attempt-id': carrier.attemptId,
            'x-invitation-auth-attempt-id': carrier.attemptId,
            'x-invitation-handoff-key': flow.attempt.cleanupKey,
          })
          if (!context) throw invitationFlowChanged()
          const bootstrap = await prepareBrowserAuthAttempt(request, context, {
            ownerHash: snapshot.ownerHash,
            ownerEpoch: snapshot.owner.epoch,
            flowId: carrier.flowId,
            attemptId: carrier.attemptId,
            fence: carrier.fence,
            cleanupKey: flow.attempt.cleanupKey,
          })
          const prepared = (await bootstrap.json()) as {
            attemptId: string
            browser: { contextId: string; generation: number }
          }
          const anchor =
            bootstrap.cookies.get(browserAnchorCookie(context.audience).name)?.value ??
            readBrowserAnchor(request.headers, context.audience)
          if (!anchor) throw invitationFlowChanged()
          const binding = new Headers({
            ...privateBrowserHeaders(context.audience),
            [BROWSER_AUTH_HEADERS.binding]: anchor,
            [BROWSER_AUTH_HEADERS.contextId]: prepared.browser.contextId,
            [BROWSER_AUTH_HEADERS.generation]: String(prepared.browser.generation),
            'x-amcore-oauth-attempt': prepared.attemptId,
          })
          binding.forEach((value, name) => headers.set(name, value))
          signal.throwIfAborted()
          const upstream = await send(headers, signal)
          const response = new Response(upstream.body, {
            status: upstream.status,
            headers: upstream.headers,
          })
          for (const cookie of bootstrap.headers.getSetCookie())
            response.headers.append('set-cookie', cookie)
          return response
        },
        undefined,
        context
      ),
    15000
  )
}
