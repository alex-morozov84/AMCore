# Overview

[Operations Console](README.md) → Overview

Use **Overview** to inspect the API process that answered this request. The page
shows readiness, dependency checks, deployment identity and three local resource
snapshots. It also identifies the web artifact serving the Console. These facts
are per instance; they do not describe a fleet or provide metric history.

## Identity and observation times

The API version and commit come from `APP_VERSION` and `APP_COMMIT`. Environment
and API deployment ID are optional operator labels (`APP_ENVIRONMENT` and
`APP_DEPLOYMENT_ID`). Unknown or unsafe version/commit values appear as
**Unknown**, never as an inferred release. Runtime mode is the separate
`NODE_ENV` value. Labels describe deployment configuration, not attested identity.

The process ID is generated at API process startup and changes on restart.
Uptime describes that process, not a deployment or machine. The **Web artifact**
ID is the build-time `NEXT_DEPLOYMENT_ID`, or a generated build UUID. It is not
an API version or commit and is not replaced by a runtime environment override.

The readiness observation and each available resource have their own timestamps,
displayed in the selected Console time zone. Choose **Refresh** for a new
observation; the page does not poll automatically or keep historical samples.
Independent snapshots are not atomic and need not equal the numbers on which a
readiness check made its decision. The server-side Overview fetch uses `no-store`
and the existing five-second whole-request deadline. That deadline does not
cancel work already running inside the API.

## Understand readiness and availability

- **Up** means that the dependency passed its readiness check.
- **Degraded** means that a completed check reported impaired service. It is
  distinct from a failed request or an instance that reports not ready.
- **Down** or **Unknown** means that the instance cannot currently confirm the
  dependency is ready. The **API instance not ready** notice names affected checks.
- An unconfigured storage probe is labelled explicitly; it does not establish
  that storage is healthy.
- **Temporarily unavailable** means that the Console could not retrieve the
  observation. Use the retry action; this is not a report that a dependency is
  down. The local web artifact ID remains visible after successful admission.

Malformed successful API responses and rejected requests reach the Console error
boundary instead of being presented as ordinary API unavailability.

## Interpret resource cards

| Card                | Scope and meaning                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local database pool | Connections, idle connections and waiting requests in this API process's `pg.Pool`; configured maximum and waiting-count readiness trigger. These counts are not database-wide utilization or a connectivity verdict.                |
| API process memory  | Node.js heap used and RSS, with the configured heap readiness trigger. RSS is not a container limit, and no RSS ceiling is inferred.                                                                                                 |
| API root filesystem | Fixed `/` inside the API container: capacity, bytes available to an unprivileged process and pressure `(capacity − available) / capacity`. Reserved space contributes to pressure; this is not host disk or object-storage capacity. |

A failed or invalid resource read makes only that card **Unavailable**, without
zero values or a fabricated sample time. Resource numbers never override the
readiness verdict. Configured triggers are comparison values, not guarantees of
capacity or remaining headroom. See [configuration](configuration.md#overview-metadata-and-resource-settings)
for the inputs and [observability](../operations/observability.md) for monitoring.
For recorded events, open [Audit](audit.md).
