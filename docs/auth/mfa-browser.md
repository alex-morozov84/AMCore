# Account-security browser journey

The account-security UI supports app setup, code verification, backup-code saving
and app replacement. Activation requires the separately approved
[deployment procedure](mfa-deployment.md). Before activation, protected operator
access is unavailable. Password/OAuth login, invitations and browser publication
share server-owned continuations. A pending continuation grants no ordinary access.

## Routes and availability

The website has `/mfa` for pending authentication and `/account/security` for
signed-in self-service. Product administration retains the same logical suffixes.
Use its [placement helpers](../product-admin/placement-and-sessions.md), not a
hardcoded administration prefix. Multi-locale builds prefix pages with the locale.
The standalone language switcher changes only the browser URL/cookie. It never
reads or updates a product profile during pending authentication.
Signed-in settings require the selected frontend session. Pending pages do not
grant a session or access to protected pages.

Dedicated BFF entries are `/api/auth/mfa` and `/api/product-admin/auth/mfa`.
They select the canonical frontend context before any work. Pending GET reads the
selected continuation's nonsecret status. POST confirms a local password, verifies
an app or backup code,
completes password login, or cancels that exact browser attempt. An untrusted
mutation returns 403; the wrong frontend host returns 404. Initial setup uses restricted enrollment handlers. Signed-in settings capture
the exact current family before rotation or replacement. Emergency recovery
accepts only a previously issued server-administrator ticket with the local password.
Responses use `Cache-Control: private, no-store`. The generic authenticated proxy
denies all `/auth/mfa` upstream paths.

Before password submission, `/api/auth/browser-context` creates a neutral browser
anchor and a separate pending attempt. Product administration uses its own BFF
entry and selected audience. The anchor is an HttpOnly session cookie. Browser
JSON receives only a nonsecret attempt identifier. A protected account receives
no ordinary session until its required proofs and publication complete.

The BFF retains the continuation before requesting credentials. One Redis update
stores the pending vault and its operation journal. The API then confirms the
exact publication. Readers verify the selected family, account security version,
browser generation and audience against the API before returning identity or
credentials. They repeat verification across token refresh. A changed context
fails with `AUTH_CONTEXT_CHANGED`; it never triggers automatic refresh.

Logout requires the session identifier captured by the displayed screen. The
API retires that exact browser generation before the BFF clears its local cookie.
An older screen cannot log out a newer winning session. An unavailable API leaves
the outcome unconfirmed; the BFF does not report successful logout or clear the
stable browser anchor.

Password and OAuth invitations use the restricted combined confirmation. It validates
the exact pending attempt before one database transaction confirms the handoff and
publishes its family. Membership still requires separate acceptance. The BFF also
checks the actual invitation owner before recovering a lost confirmation response.
Ordinary and invitation-bound browser registration retain a private publication
proposal before account creation. Account, pending family/session and email token
commit together. The BFF confirms publication before setting its session cookie.
Independent clients retain separate API sessions. Protected provider linking
captures its original family and local proof freshness through the callback.
A provider identity cannot bypass required local proofs or publish a browser session.

## Initial setup and lost responses

A current password confirmation opens the unbound app draft. The new app's unused
TOTP binds the factor and creates a restricted setup successor. The BFF retains
that successor before returning the one-time backup set. It keeps the same public
flow identifier, while replacing the private continuation and browser generation.
Saving the exact code generation precedes session issuance and publication. The
save command and publication have distinct operation IDs; the journal binds them
for a status-only recovery of the same completed session.

A status read never returns a seed or backup set. If the browser lost the backup
response after the BFF retained its successor, use the connected app's next unused
code to create a new set. If the API binding response was lost before the BFF could
retain the successor, sign in again with the password. The app stays bound. The
new setup flow requires that app's next unused code to generate replacement backup
codes. An old set cannot be acknowledged after its generation changes.

Emergency recovery consumes its ticket once and replaces the pending continuation
with restricted new-app enrollment. It returns no session, refresh credential or
backup set. Connect and verify the new app, then save its new backup codes before
publication. If the only redemption response is lost before its successor is
retained, request another ticket from the server administrator. The old ticket
cannot reconstruct its successor. This does not change normal backup-code login.

## Confirm a sensitive action

After the password, a protected account may still need an app or unused backup
code. The caller keeps the original action pending. It retries that action once
only after the server commits all fresh proofs to the original session family.
The continuation is bound to the selected vault, browser context and generation;
a newer login cannot adopt it. Closing the dialog prevents a late response from
retrying the action.

If the code response is lost, check the result before entering another code.
This check completes from already committed proofs and never resends the code.
An expired password confirmation returns to password entry. A revoked source
session or changed browser context requires a new sign-in. No continuation
response contains an ordinary access or refresh token.

## Component and adapter boundaries

`features/account-mfa` exports a headless controller and the reusable journey.
The app layer chooses the frontend adapter and destinations. Shared strict Zod
schemas define browser states and commands. Raw backend continuation, JWT,
refresh-token and publication-receipt fields are excluded from browser results.
Unknown fields are rejected, rather than silently copied into client state.

The controller keeps a setup key and a newly issued backup set outside its
serializable snapshot and the Query cache. Concealment invalidates in-flight
responses. Page exit, unmount and a safe status read erase displayed secrets.
A restored page reads nonsecret status; it cannot redisplay an issued set.
A changed-session response removes the previous identity and secrets.
Backend services separately enforce family and publication authority.

An uncertain mutation result offers a status-only read with the operation ID.
It does not automatically repeat the password, code or mutation. An ordinary
refusal keeps the form available. The server must still own proof freshness,
one-time consumption, rate limits, family binding and transaction outcomes.

## Prepared states

The flow includes local QR/manual entry, app and backup-code forms, one-time
code saving with an explicit acknowledgement, replacement confirmation, expiry,
changed-session refusal and uncertain-result recovery. A password-setup state
uses the existing password-recovery route. An emergency-recovery state has its
own password and deployment-ticket fields; it never treats that ticket as a
backup code. Initial setup and emergency-ticket redemption use connected restricted browser APIs.
Signed-in rotation keeps the current family; app replacement switches to the
restricted successor after retiring old authority.

QR generation is local. Clipboard failure keeps manual selection available.
The download is a local text file. Copying or downloading does not check the
saved-codes acknowledgement. Users must store codes somewhere available without
their phone. The UI cannot erase clipboard contents, downloads or screenshots.

## Inspect the UI safely

Use an owned managed preview with `--profile account-mfa-ui`; see
[local stands](../operations/local-stands.md#account-security-ui-preview).
That profile replaces only the client adapter in its isolated source snapshot.
It labels the journey as simulation and uses public test data. It does not write
MFA factors or change account protection. It cannot prove real enrollment,
server recovery, session publication or enforcement.
