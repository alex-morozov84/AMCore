# Prometheus alert rules (dev monitoring harness)

Drop `*.yml` alert-rule files here — `docker-compose.yml`'s `monitoring`
profile bind-mounts this directory read-only into the `prometheus` container
at `/etc/prometheus/rules/`, and
`docker/monitoring/prometheus/prometheus.yml`'s `rule_files` already globs
`*.yml` from that path, so a new file here needs no compose change.

Empty today. The shipped alert rules and an off-by-default burn-rate rules
file land here later, each proven with a `promtool test rules` fixture and
CI gate before it ships. See
[`docs/operations/observability.md`](../observability.md) for the metric
thresholds these rules will encode.
