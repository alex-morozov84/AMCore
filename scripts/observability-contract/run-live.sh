#!/usr/bin/env bash
# AMCore observability contract — live tier. Boots the real monitoring +
# local-infra Compose profiles under an isolated project name, waits for
# scrape targets AND rule evaluation, runs every live check
# (scripts/observability-contract/live/run-all.mjs), tears that stack down,
# then runs the isolated old-volume migration smoke. The main stack is torn
# down BEFORE the old-volume smoke starts (not only in the final trap) so the
# smoke's Grafana — which additively publishes both the main stack's 3001 and
# its own 3099 (Compose's default `ports:` merge is additive across
# differently-published entries, not a replace; see the smoke's own compose
# override files for why no merge tag is used) — never collides with a still
# -running main stack on the same host port. The trap is still a shell trap,
# not a Node exit handler, so cleanup runs even if a step here is killed.
set -euo pipefail

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-obs-contract-$$}"
export METRICS_AUTH_TOKEN="${METRICS_AUTH_TOKEN:-ci-fake-token-never-a-real-secret}"
export GF_SECURITY_ADMIN_PASSWORD="${GF_SECURITY_ADMIN_PASSWORD:-ci-fake-password-never-a-real-secret}"

cleanup() {
  local exit_code=$?
  echo "run-live.sh: final cleanup for project ${COMPOSE_PROJECT_NAME} (no-op if already torn down)" >&2
  docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT

echo "run-live.sh: booting project ${COMPOSE_PROJECT_NAME}" >&2
docker compose --profile local-infra --profile monitoring up -d --build \
  postgres redis migrate api worker prometheus alertmanager grafana

live_checks_failed=0
if ! node scripts/observability-contract/live/run-all.mjs; then
  live_checks_failed=1
  echo "run-live.sh: live checks failed — dumping compose logs" >&2
  docker compose -p "$COMPOSE_PROJECT_NAME" logs --no-color || true
fi

echo "run-live.sh: tearing down the main stack before the old-volume smoke" >&2
docker compose -p "$COMPOSE_PROJECT_NAME" down -v --remove-orphans

if [ "$live_checks_failed" -ne 0 ]; then
  exit 1
fi

echo "run-live.sh: running the old-volume migration smoke (isolated project)" >&2
bash scripts/observability-contract/live/old-volume-smoke.sh
