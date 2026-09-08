#!/usr/bin/env bash
# AMCore observability contract — live tier. Boots the real monitoring +
# local-infra Compose profiles under an isolated project name, waits for
# scrape targets, runs every live check (scripts/observability-contract/live/
# run-all.mjs), and tears the stack down unconditionally — a shell `trap`
# here, not a Node exit handler, so cleanup still runs if this script itself
# is killed or a step below fails.
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-obs-contract-$$}"
export METRICS_AUTH_TOKEN="${METRICS_AUTH_TOKEN:-ci-fake-token-never-a-real-secret}"
export GF_SECURITY_ADMIN_PASSWORD="${GF_SECURITY_ADMIN_PASSWORD:-ci-fake-password-never-a-real-secret}"

cleanup() {
  local exit_code=$?
  echo "run-live.sh: tearing down project ${COMPOSE_PROJECT_NAME}" >&2
  docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

echo "run-live.sh: booting project ${COMPOSE_PROJECT_NAME}" >&2
docker compose --profile local-infra --profile monitoring up -d --build \
  postgres redis migrate api worker prometheus alertmanager grafana

if ! node scripts/observability-contract/live/run-all.mjs; then
  echo "run-live.sh: live checks failed — dumping compose logs" >&2
  docker compose -p "$COMPOSE_PROJECT_NAME" logs --no-color || true
  exit 1
fi

echo "run-live.sh: running the old-volume migration smoke (isolated project)" >&2
bash scripts/observability-contract/live/old-volume-smoke.sh
