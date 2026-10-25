#!/bin/sh
# Remove the load-test entry (host, deployment checkout). Idempotent: safe after Ctrl-C, a
# k6 or sampler crash, or a lost SSH session, and safe to run twice.
# Drops docker/compose/load-test.yml from COMPOSE_FILE, recreates Caddy with the normal
# config, stops a leftover sampler. Then run remove-check.sh; data volumes stay untouched.
set -eu
. "$(dirname "$0")/lib.sh"
[ -f .env ] || die "run from the deployment checkout"
for pid in "$HOME"/amcore-load-test/*/sampler.pid; do
  [ -f "$pid" ] || continue
  kill "$(cat "$pid")" 2> /dev/null || true
  rm -f "$pid"
done
FILES=$(envval COMPOSE_FILE)
NEW=$(echo "$FILES" | tr ':' '\n' | grep -vx 'docker/compose/load-test.yml' | paste -sd: -)
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
lt_compose up -d --force-recreate --no-deps caddy
echo "recover: caddy recreated with the normal config; now run scripts/load-test/remove-check.sh"
