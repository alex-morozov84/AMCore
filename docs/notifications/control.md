# Notification delivery control

`notification-deliveries` is durable work in the common background-work registry.
It reads notification business tables. `notifications` remains a separate wake
queue. An empty wake queue does not establish an empty delivery backlog.
Both registrations import the same configured notification core. Worker transport
providers remain absent from the web process role.

## Pause and resume

The seeded PostgreSQL singleton `notification_delivery_control` owns pause state.
Claims hold its shared lock; pause/resume hold its exclusive lock. After pause
commits, no new claim can commit until resume. An earlier committed claim may
still start and finish. Pause does not cancel transport. Recovery still settles
expired leases. Resume needs no Redis wake: the recovery poller discovers due work.
A missing singleton refuses claims and pause/resume; it is not treated as unpaused.
Row commands (retry, cancel and cleanup) use delivery authority independently.
The summary cannot report pause state when the singleton is missing.

## One lifetime manual grant

Retry reserves one additional attempt; it does not send synchronously. The delivery
keeps its immutable automatic budget, original request bytes, locale, destination,
version and provider floor. Five exhausted automatic starts become a maximum of
six starts. Claiming the sixth start spends the grant. Another command or actor
cannot restore it. Cancelling a pending reservation also spends the grant.
Only pending or retry-scheduled deliveries support operator cancellation.
Processing deliveries refuse cancellation through administrative control.

Manual retry requires transient exhaustion with provable absence of acceptance,
no earlier unresolved call, an unused grant and a compatible frozen request.
The stored definition must still validate its payload and content policy. Request
body destination, binding, method/path, wire version and hash must match the
registered contract. Provider configuration must match the private saved scope.
Email requires the same currently verified canonical recipient. Telegram requires
the same active connection generation, recipient and chat. Relinking the same chat
creates a new generation and refuses the old delivery. The worker repeats these
checks at actual-start admission. Ordinary email snapshot delivery is unchanged.

## External-effect evidence

Actual-start admission commits a `possible` marker before provider I/O and increments
a durable unresolved counter. A known negative result resolves only its own marker.
A validated acceptance sets `acceptedSeen`. Timeout, network loss, malformed results,
shutdown and lost leases cannot fabricate a negative result. For example, timeout
on attempt 1 followed by a proven HTTP429 on attempt 2 still leaves attempt 1 unknown.

Telegram requires the independent HTTP429 status plus validated `ok:false` and
`error_code:429` to prove non-acceptance. A positive, safe integer `message_id` is
required for acceptance. Malformed, oversized, network, timeout, HTTP408 and 5xx
results remain unknown. Deterministic validated 4xx refusals are permanent.
Resend acceptance requires a string ID matching `[A-Za-z0-9_-]{1,128}`.
A missing, malformed or oversized ID leaves the possible call unknown.
Resend SDK failures lack an independent HTTP witness; they remain unknown and do
not authorize manual retry. Its 24-hour automatic deduplication window is not an
unlimited exactly-once guarantee. Custom channels default to unknown without a
supported witness. Historical attempted deliveries remain explicitly unverified.

## Reads and retention

The common API returns counts of pending, due, processing, failed, completed,
terminal and unresolved deliveries. `completed` excludes failed deliveries and
matches the Completed list. `terminal` includes both completed and failed
deliveries for existing API clients. Each count is capped at 10000 with an
extra-row truncation witness. Counts share a PostgreSQL sample. Channel options
derive from registrations and `in_app`. Filters use one URL-encoded JSON object,
at most 1024 UTF-8 bytes,
four string entries and 64 characters per value. Unknown filters refuse the read.

Lists order by `createdAt DESC, id DESC`, inspect 512 rows plus one truncation
witness and return at most 50 rows. List rows exclude attempt history and fit 2 KiB;
a page fits 128 KiB. Details fit 16 KiB and return the latest 16 attempts, each at
most 512 bytes. Safe fields include times, outcome, certainty, bounded reason and
manual-grant actor/command correlation. Truncation, expiry and the oldest retained
attempt number are explicit. Masked original recipients and Telegram connection
generations are approved projection fields. Raw recipient addresses/chat IDs, bodies, credentials, leases
and provider responses never enter these projections. The Interrupted outcome
means an attempt ended without normal completion; it can follow recipient
revocation or lease expiry, so it does not by itself identify the cause.

Operator cleanup removes only resolved terminal external deliveries that finished
at least 30 days ago. Age uses `terminalAt`, not creation time. It keeps the parent,
in-app delivery, siblings, command receipts and audit. Nightly parent retention
keeps its 30/90/180-day feed windows, but protects active, reserved, unknown and
legacy-unverified work. Protection may retain unknown evidence indefinitely.
Finished-attempt pruning requires resolved terminal work; grant-linked attempts
remain while the delivery exists. Compact certainty/grant metadata and the pruning
marker survive removal of other attempts or expiry of command receipts.

Transactions lock target, existing parent, delivery, then attempt when those
categories are needed. Each category sorts IDs before entering the next. Finalize,
reaper and revoke never acquire a parent after a delivery. Cleanup locks parents
before all children; it bounds parents to 50 and children to 4096 plus one witness.
Statement and lock limits refuse oversized or contended work rather than widening
lock duration.

## Upgrade

Stop all old API roles and their automatic restart before applying
`20261011170000_notification_delivery_control`. The migration checks known
`amcore-web`, `amcore-worker` and `amcore-all` connections before changing state.
This check is a tripwire, not a fence over differently named clients. Do not run
mixed old/new writers. Preserve a verified backup for restore-based rollback.
Frozen requests and their hashes are not rewritten. Attempted historical rows
become legacy-unverified rather than receiving invented no-effect evidence.
