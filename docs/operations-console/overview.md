# Overview

[Operations Console](README.md) → Overview

Use **Overview** to check the state of the API instance that answered the
request. It shows the application version, process role, and a status for each
dependency. The information comes from the same readiness checks used by
`/health/ready`; it is a snapshot of this instance, not a fleet-wide dashboard.

## Understand the status

- **Up** means that the dependency passed its readiness check.
- **Down** or **Unknown** means that the instance cannot currently confirm that
  dependency is ready. The **API instance not ready** notice names the affected
  dependencies. Choose **Refresh** to check again.
- **Temporarily unavailable** means that the Console could not retrieve the
  Overview result. Use the retry action; do not interpret this as a report that
  a particular dependency is down.

The version and process role describe the responding instance. Hover or focus
the information icons beside those labels for explanations in the interface.
Overview does not provide historical metrics, queue controls, or activity
history. To inspect recorded events, open [Audit](audit.md).
