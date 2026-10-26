# Queued email safety and recovery

Welcome email uses the registered `email` work and conservative queued recipe2.
Verification, reset and invitation links use direct-secret sends. Password-change
alerts use notification delivery. Those paths retain separate recovery contracts.

## Immutable request

The worker renders before its first possible send. It freezes sender, recipient,
subject, HTML, plaintext, reply-to, digest, provider scope and internal identity.
The Resend adapter also forwards the stable key `email:<incarnation>`.
A forwarded key alone does not establish safe replay for another transport.

The private Redis body is limited to128KiB,1,024 reservations and64MiB total.
Its24-hour expiry is a local storage limit, not a provider retry guarantee.
Missing or expired content refuses sending; an admitted request is never re-rendered.
Changing the sender, credentials or template cannot replace a frozen request.
PG stores safety metadata and digests, not recipients, bodies or credentials.

Eligible terminal cleanup removes only the matching private body and reservation.
It does not delete independent uncertainty or refund an execution grant.
A new BullMQ incarnation does not prove that an earlier business email failed.

## Delivery certainty

| Certainty  | Meaning and action                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| `none`     | All possible effects have authoritative nonacceptance evidence. A transient failure may qualify for bounded retry.        |
| `unknown`  | Acceptance remains possible. Stop automatic and manual submission.                                                        |
| `accepted` | The exact request was accepted by the provider or relay. Suppress further submission. This does not prove inbox delivery. |

PG reserves an attempt before transport. A crash after reservation can leave an
unsent welcome permanently blocked. Timeout, disconnect or a lost final reply
cannot establish nonacceptance. A later `none` result cannot clear older uncertainty.
Current unsuccessful Resend SDK results, including429, remain `unknown` and stop
recovery. Do not infer authoritative HTTP status from parsed provider error fields.

Unknown results fail with `EFFECT_UNKNOWN`. Unrecorded live-owner results use
`OUTCOME_UNRECORDED`. Stale-owner recovery requires a new broker claim, revoked
refencing authority and expiry of the old cached local fence. A timeout alone does
not prove remote cancellation. A late verified acceptance updates the original attempt.

## Retry window and cooldown

Recipe2 requires no provider-relative clock qualification or deduplication window.
It preserves local worker ownership and fresh PG/Redis checks before transport.
Local wall/monotonic disagreement or a stale sample can refuse admission.
Client abort limits waiting; it cannot recall a provider's accepted request.

Each intent has its frozen automatic budget: default3, supported1–10 attempts.
One lifetime manual grant remains available only for eligible aggregate `none`.
Counters, first reservation, request identity and grants never reset on restart.

A supported transient `none` result persists the minimum delay. It is the larger
of ordinary exponential backoff (1000ms base) and the adapter's reviewed duration.
The queued Resend recipe supports decimal `Retry-After` seconds, up to24 hours.
A present date, malformed value or longer duration blocks retry with
`CONTENT_UNSUPPORTED`; it does not become ordinary backoff. Unknown certainty
still takes precedence over that input error. SMTP does not require HTTP headers.

A worker waits the full saved duration using process-local monotonic time.
Restart, changed worker, lost anchor or detected discontinuity starts the full
wait again. Repeated restarts can prevent progress indefinitely. Broker due time
and wall-clock jumps cannot satisfy the delay. Cooldown claims spend neither an
automatic attempt nor a manual grant and do not report a failed send.

Manual retry also requires original content/scope, supported transient evidence
and an available grant. The worker waits for the committed ADMIN receipt before
spending its reserved grant. Unknown ADMIN commands are never dispatched again.

The approved queued adapter performs one application submission per attempt to
one recipient. An adapter without remote deduplication can support first submission
and proven-none retry. It must classify ambiguity and disable hidden submission
retries. No production SMTP adapter is included; a protocol fixture tests this boundary.
See the [provider contract](delivery.md#provider-contract) before extending it.

## Inspect a stopped welcome

1. Read authorized job and PG evidence diagnostics. Record identity, certainty,
   safe reason and provider ID when present. Do not dump bodies or token links.
2. Preserve active/unrecorded attempts. Establish owner termination before recovery.
   Missing provider search results or elapsed time do not prove nonacceptance.
3. Acknowledge retained unknown only through the audited metadata action when
   eligible. This preserves uncertainty, history, execution grants and quota.
4. Leave delivery unresolved by default. A separate business reissue requires
   explicit approval of duplicate risk and a link to the original intent.
   This recipe provides no automatic reissue or override-to-`none` action.

The worker emits existing bounded dead-letter/error signals. Cooldown is not an
error loop. Monitor those signals through your existing operations tooling.
No alert email is generated by this policy.

## Retention and upgrades

Unknown evidence survives broker trimming, acknowledgment and body expiry.
It remains quota-accounted: up to10,000 unresolved rows globally and2,000 per work.
Capacity exhaustion refuses new effects; cleanup cannot erase uncertainty to
admit another send. Unknown rows compact within the existing512-byte logical limit.
Definitive unfenced evidence retains the existing30-day cleanup policy.

Initialized broker markers without PG evidence refuse with `OUTCOME_UNRECORDED`.
A bounded result buffer retries PG recording only; eviction cannot authorize sending.
PG or broker outage refuses new admission.

Old version1 records are not relabelled as safe version2 work. Raw legacy WELCOME
claims quarantine before any render/send; known secret-bearing legacy input still
completes without sending. Use the [offline upgrade procedure](queued-upgrade.md)
for untouched version1 jobs. Keep retained unknown evidence and its original limits.
