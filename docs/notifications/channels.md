# Register a notification channel

A channel registration connects a transaction-aware target reader, worker
transport and optional HTTP surface. Add one descriptor to
[`NOTIFICATION_CHANNELS`](../../apps/api/src/core/notifications/notification-composition.ts)
and reference its identifier in notification definitions. Channel identifiers are
bounded lowercase strings; adding a channel does not require a database enum or a
new dispatcher state machine.

## Core and worker module graph

The composition creates `NotificationsCoreModule.register({ definitions, channels })`
once. `NotificationsModule` imports that exact configured module and re-exports
its core providers. Business producers and HTTP modules import this static facade.
Do not independently call `register()` from each consumer.

Each descriptor declares:

| Field                                   | Responsibility                                                 |
| --------------------------------------- | -------------------------------------------------------------- |
| `id`                                    | Stable external channel identifier; `in_app` is reserved.      |
| `targetMode`                            | `snapshot` or `generation`.                                    |
| `core.module`, `core.token`             | Reader module and its exported reader token.                   |
| `worker(core)`                          | Dynamic worker module importing the same core facade.          |
| `delivererToken`                        | Exported worker deliverer token.                               |
| `web(core)`                             | Optional dynamic HTTP module importing the same core facade.   |
| `available(env)`                        | Code-owned configuration availability.                         |
| `wireVersion`, `requestSchema`          | Retained prepared request contract.                            |
| `requestTargetsDelivery(body, context)` | Checks actual body destination against the immutable delivery. |

`ConfiguredNotificationsWorkerModule.register(core, channels)` derives deliverer
providers from this inventory and validates token/channel agreement. Adapter
modules import `NotificationExecutionModule` so dispatch and adapters share one
shutdown latch and capacity gate. `NotificationsWebModule` derives optional HTTP
modules from the same descriptors. Worker transports are absent from web DI;
the application composition may still statically import their JavaScript files.

Use the shipped email and Telegram reader/delivery modules as references. A
worker module exports its deliverer, imports the core facade and any transport
infrastructure, and provides `NotificationPreparedRequestService`. Its reader
module exports only the reader and the dependencies needed for headless reads.

## Read targets on the caller's transaction

Implement `ChannelTargetResolver.resolveTargets(tx, context)` as an asynchronous
read on the supplied `Prisma.TransactionClient`. Do not open another transaction,
use the base Prisma client, perform network I/O, or require channel-specific
fields on the common recipient context.

Return at most 100 targets, with unique non-empty `targetKey` values (255 characters
maximum), optional bounded `targetRef` and a redacted JSON `destinationSnapshot`
of at most 4 KiB. Invalid/duplicate/oversized targets refuse the transaction before
delivery rows are written. A bounded `skipReasonCode` records a terminal absence
without scheduling a send.

For a generation target, read the subscription/connection under the lock that
its revoke writer contends on. Telegram uses connection `FOR SHARE` before delivery
locks. Implement `ChannelDeliverer.checkTarget(tx, context)` with the same lock
order; verify generation, recipient, destination and active state at preparation
and actual-start admission. Revocation must cancel active deliveries and close
open attempts atomically. An absent row lock does not prevent a later link; that
later link cannot add a delivery to an existing occurrence.

## Availability and content

An unavailable optional channel is omitted from newly produced work and advertised
capabilities. A selected mandatory channel that is unavailable refuses production
instead of silently dropping the required delivery. Availability does not bypass
validation or provide transport credentials to the core.

Add the channel to a definition's `supportedChannels`, choose defaults/mandatory
channels, and retain version-specific content policy. Detailed content needs both
`projectExternal(channelId, payload)` and `renderExternal[channelId]`; the latter
receives the projection only. Never put a token, signed URL or credential in a
payload, destination projection or prepared request.

## Prepare and send

Call `NotificationPreparedRequestService.obtain()` with the delivery context,
deliverer, logical binding, path, stable key and a first-preparation callback.
Build the envelope with `preparedNotificationRequest()`. The schema and
`requestTargetsDelivery` must validate the actual body, not just its checksum.
Keep the complete envelope within 128 KiB UTF-8.

If preparation returns a refusal, return it without I/O. Otherwise pass exactly
one transport closure to `admission.send()`. Send the stored body verbatim, use
live credentials and the supplied abort signal, and map provider errors to bounded
codes. Never enqueue another transport job or log the request. A known preparation
failure may use `NotificationPreparationError`; unexpected database errors propagate
and fail closed.

The supported multi-subscription registration is executable in
[`notification-registration.ts`](../../apps/api/test/fixtures/extension-contracts/notification-registration.ts).
Its synthetic channel and subscription table exist only in tests. Run:

```bash
pnpm --filter api test:e2e --runTestsByPath \
  test/extension-registration.e2e-spec.ts \
  test/notification-extension-contracts.e2e-spec.ts \
  test/notification-prepared-request.e2e-spec.ts
```

A downstream channel should retain these checks for registration identity, role
capabilities, transaction-local subscriptions, immutable targets, replay, request
freeze, revoked generations and zero-I/O refusals. Real transports also need an
installed SDK or fake-fetch assertion of the actual body/key and cancellation.

## Run the conformance lane

`pnpm test:extension-contracts` copies the current public source into a temporary
workspace, builds shared contracts, generates Prisma, typechecks the API and runs
the registered fixtures against isolated PostgreSQL/Redis Testcontainers. It needs
Docker; it never uses your ordinary `.env` or preview data. Failed copies remain
for diagnosis, successful copies are removed. The CI Test job invokes this command.

The notification cases live in `extension-registration.e2e-spec.ts`,
`notification-extension-contracts.e2e-spec.ts` and
`notification-prepared-request.e2e-spec.ts` under `apps/api/test/`.
`notification-ai-legacy-migration.e2e-spec.ts` starts from the old schema and checks
the upgrade matrix. Use these registered module fixtures for a new channel;
checking only a manually constructed reader or deliverer does not prove role DI.
