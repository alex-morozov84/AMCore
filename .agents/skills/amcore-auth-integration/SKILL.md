---
name: amcore-auth-integration
description: Implement or change AMCore sign-in, refresh, logout, OAuth integration or authenticated client and recipient session handoff. Excludes permission policy, ordinary user sign-in and operational MFA activation.
---

# AMCore authentication integration

Read `PROJECT_CONTEXT.md` and the applicable product instructions. Identify the
client, entrypoint and actual authentication flow before choosing its owners.
Use local product guides; do not replace existing correct code with a generic
JWT/OAuth example or fetch upstream main as the product's rules.

## Select the protocol owner

- Sign-in, refresh, logout or session ownership: [sessions](../../../docs/auth/sessions.md).
- Provider, callback or account linking: [OAuth](../../../docs/auth/oauth.md).
- Verification/reset and recipient entry: [email auth](../../../docs/auth/email-auth.md)
  and the affected invitation/provisioning owner.
- Browser-origin protection: [CSRF](../../../docs/auth/csrf.md).
- Protected or partial authentication: [MFA foundation](../../../docs/auth/mfa-foundation.md).
- A different host/session audience: [placement and sessions](../../../docs/product-admin/placement-and-sessions.md).

Read the relevant current section before implementing or revising that flow.
A successful identity callback, partial response or prepared credential is not
necessarily a published session or consent to organization membership.

## Preserve the important boundaries

1. Distinguish browser, native client, operator and recipient responsibilities.
   Preserve server-selected context, Origin/cookie/nonce binding and the current
   session family; a user ID alone is not a session boundary.
2. Distinguish complete authentication, restricted continuation and unknown result.
   Use the current flow's observation/continuation/acknowledgment rules. Do not
   repeat a credential mutation blindly or turn a lost reply into rollback.
3. Keep required password and second-factor proofs independent. Do not complete
   an MFA flow through a password-only legacy path or invent a separate protocol.
4. Keep session publication, recipient consent and resource authorization separate.
   Permission-policy changes use authorization-extension, not a login rewrite.
5. For a provider, verify the existing interface, callback/profile mapping and
   security requirements in the owner. Do not assume every provider supports the
   same identity proof or use provider profile data as an authorization grant.

## Verify and report

Choose checks for affected success, refusal, partial/unknown and session-change
paths, including actual client/server boundaries where required. Existing tests
are witnesses only for their covered implementation and environment.
Report the selected flow, current guides, changes, proof/publication boundaries,
checks actually run and gaps. No skill or example grants external/provider,
production, enrollment-reset or deployment authority. Operational MFA activation
and trusted recovery belong to mfa-operations; ordinary user sign-in is not a
reason to execute this integration workflow.
