# Grafana dashboards (dev monitoring harness)

Drop exported dashboard JSON here — `docker-compose.yml`'s `monitoring`
profile bind-mounts this directory read-only into the `grafana` container at
`/var/lib/grafana/dashboards`, and
`docker/monitoring/grafana/provisioning/dashboards/dashboards.yml` already
watches this path, so a new file here needs no compose or provisioning
change.

- **`amcore-overview.json`** — one dashboard covering every category in
  `docs/operations/observability.md`'s metric family reference (HTTP, Node
  runtime, metrics-collector health, DB, Redis, queues/outbox, email,
  realtime, AI, rate limiting, cache, storage & media), organized as one
  row per category. Built and verified against this harness's real scraped
  data (not hand-typed blind): every panel's PromQL was checked to return
  either real data or a legitimately empty result (e.g. no 5xx errors on a
  healthy dev stack), never a query error, and the checked-in file is
  confirmed byte-identical to what Grafana actually provisions from it on
  a clean boot. References the datasource by the fixed `amcore-prometheus`
  uid set in `../provisioning/datasources/prometheus.yml`, not Grafana's
  own auto-generated one, so it survives a re-provision — including on a
  `grafana_data` volume created before that fixed uid existed (that
  provisioning file's own `deleteDatasources` step handles the migration;
  see its comments).
