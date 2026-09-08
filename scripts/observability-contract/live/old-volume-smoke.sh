#!/usr/bin/env bash
# AMCore observability contract — old-volume Grafana migration smoke (item 3,
# third half). Proves a `grafana_data` volume seeded under the LEGACY
# pre-fix datasource provisioning (no explicit uid, no deleteDatasources)
# migrates cleanly once the real, fixed provisioning takes over — the exact
# scenario docker/monitoring/grafana/provisioning/datasources/prometheus.yml's
# own header comment describes. Isolated project/volume — run-live.sh tears
# the main stack down before calling this script, so this smoke's Grafana
# (published on both 3001 and 3099, additively — see the compose override
# files) never collides with a still-running main stack. `--no-deps` skips
# the base file's Prometheus dependency so only this one container starts.
set -euo pipefail

export COMPOSE_PROJECT_NAME="${OLD_VOLUME_PROJECT_NAME:-obs-contract-oldvol-$$}"
export GF_SECURITY_ADMIN_PASSWORD="${GF_SECURITY_ADMIN_PASSWORD:-ci-fake-password-never-a-real-secret}"
GRAFANA_URL="http://127.0.0.1:3099"
AUTH="admin:${GF_SECURITY_ADMIN_PASSWORD}"

cleanup() {
  local exit_code=$?
  echo "old-volume-smoke: tearing down project ${COMPOSE_PROJECT_NAME}" >&2
  docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

wait_for_datasources() {
  for _ in $(seq 1 30); do
    if curl -fsS -u "$AUTH" "${GRAFANA_URL}/api/datasources" >/tmp/obs-contract-datasources.json 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "old-volume-smoke: Grafana never became ready" >&2
  return 1
}

echo "old-volume-smoke: phase A — legacy no-uid provisioning" >&2
docker compose --profile monitoring \
  -f docker-compose.yml -f docker-compose.observability-contract.old-volume.yml \
  up -d --no-deps grafana
wait_for_datasources
if ! grep -q '"name": *"Prometheus"' /tmp/obs-contract-datasources.json; then
  echo "old-volume-smoke: phase A did not provision a Prometheus datasource" >&2
  exit 1
fi
if grep -q '"uid": *"amcore-prometheus"' /tmp/obs-contract-datasources.json; then
  echo "old-volume-smoke: phase A unexpectedly already has the fixed uid — fixture is not reproducing the legacy state" >&2
  exit 1
fi

echo "old-volume-smoke: phase B — real shipped provisioning, same volume" >&2
docker compose -p "$COMPOSE_PROJECT_NAME" stop grafana
docker compose -p "$COMPOSE_PROJECT_NAME" rm -f grafana
docker compose --profile monitoring \
  -f docker-compose.yml -f docker-compose.observability-contract.old-volume.migrated.yml \
  up -d --no-deps grafana
wait_for_datasources

count=$(python3 -c "import json;print(len(json.load(open('/tmp/obs-contract-datasources.json'))))")
if [ "$count" != "1" ]; then
  echo "old-volume-smoke: expected exactly 1 datasource after migration, found ${count}" >&2
  exit 1
fi
if ! grep -q '"uid": *"amcore-prometheus"' /tmp/obs-contract-datasources.json; then
  echo "old-volume-smoke: migrated datasource is not at the fixed uid amcore-prometheus" >&2
  exit 1
fi

echo "old-volume-smoke: passed — legacy uid gone, amcore-prometheus present" >&2
