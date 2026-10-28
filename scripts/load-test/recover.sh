#!/bin/sh
# Remove the load-test entry (host, deployment checkout). Idempotent: safe after Ctrl-C, a
# k6 or sampler crash, or a lost SSH session, and safe to run twice.
# Drops docker/compose/load-test.yml from COMPOSE_FILE, recreates Caddy with the normal
# config, stops a leftover sampler. Then run remove-check.sh; data volumes stay untouched.
set -eu
. "$(dirname "$0")/lib.sh"
[ -f .env ] || die "run from the deployment checkout"
PROJECT=$(envval COMPOSE_PROJECT_NAME)
RUN=$(envval LOAD_TEST_RUN_ID)
run_id_ok "$RUN" && [ "$PROJECT" = "amcore-loadtest-$RUN" ] || die "not this run's load project"
for pid in "$HOME"/amcore-load-test/*/sampler.pid; do
  [ -f "$pid" ] || continue
  kill "$(cat "$pid")" 2> /dev/null || true
  rm -f "$pid"
done
FILES=$(envval COMPOSE_FILE)
NEW=$(echo "$FILES" | tr ':' '\n' | grep -vx 'docker/compose/load-test.yml' | paste -sd: -)
# Validate the normal Caddy configuration BEFORE changing .env. The temporary model
# excludes all other services/volumes and reuses only inspected owned edge resources.
recovery_dir=$(mktemp -d)
chmod 700 "$recovery_dir"
trap 'rm -rf "$recovery_dir"' 0
trap 'exit 130' INT
trap 'exit 143' TERM HUP
(umask 077; lt_compose COMPOSE_FILE="$NEW" config --format json > "$recovery_dir/config.json")
volumes=$(docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT")
networks=$(docker network ls -q --filter "label=com.docker.compose.project=$PROJECT")
[ -n "$volumes" ] && [ -n "$networks" ] || die "owned Caddy volumes/network missing; nothing recreated"
# shellcheck disable=SC2086 # Docker resource names/IDs contain no whitespace.
(umask 077; docker volume inspect $volumes > "$recovery_dir/volumes.json")
# shellcheck disable=SC2086
(umask 077; docker network inspect $networks > "$recovery_dir/networks.json")
# Host redirection owns the 0600 result; container UID never owns a host output file.
(umask 077; docker run --rm -v "$recovery_dir:/d:ro" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" \
  node /lt/recover-caddy.mjs /d "$PROJECT" > "$recovery_dir/caddy.json")
if [ "$NEW" != "$FILES" ]; then
  # .env holds secrets: the backup lives outside the checkout (git does not ignore other
  # .env names), and both copies keep its owner and mode (-p, then overwrite in place).
  BACKUP="$HOME/amcore-load-test/env.before-recover.$(now)"
  mkdir -p "$HOME/amcore-load-test"
  chmod 700 "$HOME/amcore-load-test"
  cp -p .env "$BACKUP"
  cp -p .env ".env.recover.$$"
  # Rewrite only the COMPOSE_FILE line; every other line stays byte-identical.
  awk -v v="$NEW" 'BEGIN {done = 0} /^COMPOSE_FILE=/ {if (!done) {print "COMPOSE_FILE=" v; done = 1}; next} {print}' "$BACKUP" > ".env.recover.$$"
  mv ".env.recover.$$" .env
  echo "recover: removed load-test.yml from COMPOSE_FILE (previous .env kept as $BACKUP)"
else
  echo "recover: COMPOSE_FILE has no load-test overlay"
fi
lt_compose -f "$recovery_dir/caddy.json" up -d --force-recreate --no-deps caddy < /dev/null
echo "recover: caddy recreated with the normal config; now run scripts/load-test/remove-check.sh"
