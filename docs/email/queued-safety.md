# Queued email safety and recovery

Queued email uses the registered `email` work and the approved provider-window
recipe. Only explicitly queueable non-secret templates enter this path. Password
reset, verification and invitation links stay in direct sends.

## Immutable request

The worker validates the payload and renders once before its first possible send.
It freezes the exact sender, recipient, subject, HTML, plaintext and reply-to bytes,
their digest, provider scope/version and idempotency key `email:<incarnation>`.
Retries reuse these bytes and key. Changing the deployed template, sender or
credentials cannot silently replace the request.

The private Redis body is bounded at128KiB. Its fixed quota is1,024 reservations
and64MiB; expiry is at most24 hours from preparation. Expired/missing body refuses
another send instead of re-rendering. PG retains only safety metadata and digests,
not addresses, rendered bodies or credentials. Do not log or expose the private body.
Eligible terminal cleanup atomically removes the matching incarnation's private
body and its count, byte, expiry and size reservation. Capacity becomes available
immediately. Cleanup never removes independent PG uncertainty or refunds a lifetime
grant. Corrupt reservation accounting refuses before any write.

A recycled BullMQ job ID receives a new incarnation. It does not renew an old
request's provider window or prove that an old delivery failed. Business reissue
must be an explicit domain decision, with its own durable duplicate/loss policy.

## Delivery certainty

| Certainty  | Meaning                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| `none`     | Every recorded admitted attempt has authoritative no-effect evidence; no older unresolved attempt remains. |
| `unknown`  | A call may have been accepted, is in flight, or lacks a valid fenced outcome.                              |
| `accepted` | The exact immutable request was authoritatively accepted under its frozen provider scope/key/body.         |

A timeout or network failure after transport admission is unknown. A current
rejection cannot clear an earlier unknown attempt. A job completion, failed state,
missing hash or elapsed time is not delivery evidence. Accepted certainty is
monotonic and suppresses further sends, including after a lost worker acknowledgement.

PG records a possible-call reservation before each send. The current worker must
then pass its broker lock/incarnation/attempt and time fence. Each incarnation has
a finite automatic budget (the declared1–10 attempts) and one lifetime manual
grant. Counters, the first reservation time and request identity are never reset.
Ordinary idempotent work uses business deduplication instead of this PG mechanism;
see [background-work policies](../backend/background-work.md).

## Retry window and cooldown

The provider recipe uses an immutable24-hour horizon measured from the first PG
possible-call reservation. Deployment requires PG, Redis and worker wall clocks
each within±2 seconds of the provider reference. Opposite timestamp offsets can
differ by4 seconds; the checks reserve that allowance at both ends.

Immediately before transport, the shared helper requires
`max(redisTime + elapsed, wallTime) + 94000 < nominalDeadline`. The94 seconds
include4 seconds of timestamp uncertainty,1 second of scheduling allowance,
30 seconds of maximum transport lifetime and59 seconds of residual safety margin.
Redis and PG samples must be at most1 second old. Wall/monotonic disagreement
above200ms, negative elapsed time or unsupported clock arithmetic refuses a call.
After a stale pre-call fence, one refresh may re-fence the same attempt; it does
not spend another start or renew the deadline.

An abort signal is set to30 seconds. This does not establish a remote provider's
acceptance bound. Operations must maintain the stated clock, scheduling and
transport assumptions. Suspend/descheduling or clock corrections can cause safe
refusals; inspect synchronization and provider/network health before reissue.
Do not consume the59-second safety margin to excuse an assumption violation.

`Retry-After` duration or absolute-date constraints become a monotonic latest-safe
PG floor. A call requires the current lower time bound to reach that floor;
opposite offsets cannot authorize an early call. A waiting cooldown moves the
locked job to delayed without recording a provider call or spending a start.
Unsupported retry-clock information blocks further calls. A delay beyond the
immutable horizon expires the request rather than extending its window.

Manual retry additionally requires aggregate `none`, a supported transient result,
the original body/scope, available grant and satisfied floor/horizon. Unknown or
accepted delivery is not manually retryable. An ADMIN retry reserves its grant
and command fence before Redis dispatch; the worker waits for the committed
receipt or an audited uncertainty disposition. Unknown ADMIN commands are never
redispatched.

While an applied broker retry awaits receipt commit or audited disposition, its
actual worker claims are deferred by the existing bounded delayed transition,
with a1-second broker recheck. These claims spend no possible-call ordinal or
manual grant and do not increment completed failed attempts. They retain the
original floor, horizon and command identity; reaching the horizon refuses the
request rather than extending the wait into new effect authority.

The registered handler emits terminal `email.job.dead_letter` and worker
`queue.worker_error` signals with bounded labels, without raw payloads or provider
exception text. Process-duration/result metrics cover admitted provider-policy
execution and known-secret discard; cooldown/receipt deferral is not a failed
send. Pre-policy malformed input is reported through terminal failure observation.

## Legacy queue entries

Known secret-bearing legacy input completes without rendering or sending, before
wire/schema validation. Malformed non-secret input fails permanently.
The closed WELCOME compatibility path supports the original bounded options
profile; unsupported options are refused without rewriting request/options.

A first current claim with `ats=1`, `atm=0`, no prior managed evidence and no
failure witness may adopt a new incarnation under the worker lock. Its request
is then frozen and admitted through the normal PG/broker gates before any effect.
Counters are not reset. A previously started legacy request receives independent
`LEGACY_REQUEST_UNKNOWN` evidence before changing its broker format. It has no
reproducible provider body/scope or newly inferred first-send time, so it cannot
send or acquire a safe retry horizon. Quota failure prevents the format change
and effect. Inspect original business/worker records before any domain reissue.

## Retention and recovery

Independent evidence survives stock BullMQ completion/failure trimming. Missing
PG evidence for an initialized broker marker is `OUTCOME_UNRECORDED`, not permission
to resend. A bounded in-memory result buffer may retry recording an outcome;
eviction or restart cannot establish certainty or authorize a provider call.

Recorded unknown effects can receive an audited metadata disposition with captured
incarnation/revision, reason and bounded incident references. An active/unrecorded
attempt must remain protected until its original horizon is certainly past.
Disposition preserves uncertainty, starts, grant, fence and unresolved/row quotas.
It is not proof of acceptance or nonacceptance.

Definitive unfenced evidence is eligible for30-day retention cleanup. Unknown
evidence, including acknowledged unknown, is compacted and retained within finite
quotas; it is not evicted to admit more sends. See
[capacity and maintenance](../backend/background-work.md#retained-uncertainty-and-capacity).
PG outage refuses new possible effects. Broker outage prevents broker admission;
PG diagnostics and metadata recovery remain independently available to the backend.
