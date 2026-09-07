# Grafana dashboards (dev monitoring harness)

Drop exported dashboard JSON here — `docker-compose.yml`'s `monitoring`
profile bind-mounts this directory read-only into the `grafana` container at
`/var/lib/grafana/dashboards`, and
`docker/monitoring/grafana/provisioning/dashboards/dashboards.yml` already
watches this path, so a new file here needs no compose or provisioning
change.

Empty today. Example dashboards land here later as plain exported Grafana
dashboard JSON, verified against real scraped data from this same harness
before they ship.
