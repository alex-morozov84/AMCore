# Dormant account-security browser journey

The account-security UI prepares app setup, code verification, backup-code saving
and factor replacement. It does not enable MFA in this deployment. Normal login
remains unchanged. The [foundation startup check](mfa-foundation.md#deployment-boundary)
still refuses active MFA data. There is no activation command or enrollment API.

## Routes and availability

The website has `/mfa` for pending authentication and `/account/security` for
signed-in self-service. Product administration retains the same logical suffixes.
Use its [placement helpers](../product-admin/placement-and-sessions.md), not a
hardcoded administration prefix. Multi-locale builds prefix pages with the locale.
Signed-in settings require the selected frontend session. Pending pages do not
grant a session or access to protected pages.

Dedicated BFF entries are `/api/auth/mfa` and `/api/product-admin/auth/mfa`.
They select the canonical frontend context before any work. GET returns only
`{ "kind": "unavailable" }`. Trusted POST returns 503; an untrusted mutation
returns 403, and the wrong frontend host returns 404. These entries do not read
submitted proofs, create flows, bind factors, publish cookies or call an MFA API.
Responses use `Cache-Control: private, no-store`. The generic authenticated proxy
continues to deny all `/auth/mfa` upstream paths.

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
These UI measures do not implement backend family or publication enforcement.

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
backup code. These are prepared presentation states, not working recovery APIs.

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
