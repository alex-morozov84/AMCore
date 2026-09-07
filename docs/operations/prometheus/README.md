# Prometheus alert rules (dev monitoring harness)

`docker-compose.yml`'s `monitoring` profile bind-mounts this directory
read-only into the `prometheus` container at `/etc/prometheus/rules/`, and
`docker/monitoring/prometheus/prometheus.yml`'s `rule_files` globs `*.yml`
directly under this path — a new top-level file here needs no compose
change to load.

- **`amcore-alerts.yml`** — the shipped alert rules, one rule group per
  metric category. Every rule has a firing-case test and a genuine
  healthy-case test (`exp_alerts: []`) in `tests/amcore-alerts_test.yml`;
  every rule that joins two metric families with `or`/`and` also has an
  asymmetric-health firing test (one side healthy, the other firing)
  proving neither side masks the other — all checked in CI (`promtool`
  job) on every PR. See
  [`docs/operations/observability.md`](../observability.md) for the
  thresholds these rules encode and how they route through Alertmanager.
- **`optional/amcore-slo-burn-rate.yml`** — multiwindow multi-burn-rate SLO
  alerting (Google SRE Workbook), off by default: this `optional/`
  subdirectory is deliberately NOT reached by the `*.yml` glob above
  (Prometheus glob patterns are not recursive). See the file's own header
  for the one-line change that enables it. Tested the same way, in
  `optional/tests/amcore-slo-burn-rate_test.yml`.

Runbooks these alerts link to (`runbook_path`, a repo-relative path, not an
absolute URL) land in a later pass — until then the linked
`docs/operations/runbooks/*.md` files do not exist yet.
