#!/bin/sh
# Load-test preflight, run on the host in the deployment checkout (docs/operations/load-testing.md).
#   preflight.sh plan  before the first `docker compose up` of the run: changes nothing
#                      (only `compose config` and throw-away image runs for caddy adapt).
#   preflight.sh live  after the run's project is up: checks the created resources.
set -eu
. "$(dirname "$0")/lib.sh"
MODE=${1:-}
[ -f .env ] && [ -f PROJECT_CONTEXT.md ] || die "run from the deployment checkout (needs .env and PROJECT_CONTEXT.md)"

ctx() { sed -n "s/^- \*\*$1:\*\* *//p" PROJECT_CONTEXT.md | head -n 1; }
RUN=$(envval LOAD_TEST_RUN_ID)
GEN=$(envval LOAD_TEST_GENERATOR_IP)
PROJECT=$(envval COMPOSE_PROJECT_NAME)
CA_DIR=$(envval LOAD_TEST_CLIENT_CA_DIR)
SECRETS=$(envval LOAD_TEST_SECRETS_DIR)
WEB_IP=$(envval COMPOSE_WEB_IPV4)

# Topology: path-mode product web edge, the TLS database and the exact web peer only.
[ "$(ctx admin_console_mode)" != host ] || die "admin_console_mode: host is not supported by the reference load test"
I18N=$(ctx i18n_mode)
BASE=$(ctx base_locale)
case "$I18N" in multi) PREFIX="/$BASE" ;; single) PREFIX= ;; *) die "unknown i18n_mode '$I18N'" ;; esac
FILES=$(envval COMPOSE_FILE)
for f in docker-compose.yml docker/compose/postgres-tls.yml docker/compose/web.yml docker/compose/bff-relay.yml docker/compose/load-test.yml; do
  echo ":$FILES:" | grep -q ":$f:" || die "COMPOSE_FILE must include $f"
done
for f in $(echo "$FILES" | tr ':' ' '); do
  case "$f" in
    docker-compose.yml | docker/compose/postgres-tls.yml | docker/compose/web.yml | docker/compose/bff-relay.yml | docker/compose/load-test.yml | docker/compose/supervise.yml | docker/compose/prod.yml) ;;
    *) die "COMPOSE_FILE entry $f is not part of the supported load-test topology" ;;
  esac
done
echo ",$(envval COMPOSE_PROFILES)," | grep -q ',local-infra,' || die "COMPOSE_PROFILES must include local-infra (bundled database owned by this run)"

# Run identity and inputs.
run_id_ok "$RUN" || die "LOAD_TEST_RUN_ID must be 4-32 lowercase letters or digits"
[ "$PROJECT" = "amcore-loadtest-$RUN" ] || die "COMPOSE_PROJECT_NAME must be amcore-loadtest-$RUN"
ipv4 "$GEN" || die "LOAD_TEST_GENERATOR_IP must be one IPv4 address (IPv6 and ranges are not supported)"
[ -s "$CA_DIR/ca.crt" ] || die "LOAD_TEST_CLIENT_CA_DIR must hold ca.crt"
[ ! -e "$CA_DIR/ca.key" ] || die "keep the client CA private key out of LOAD_TEST_CLIENT_CA_DIR"
[ -s "$SECRETS/fixture-password" ] || die "LOAD_TEST_SECRETS_DIR must hold fixture-password"

adapted() {
  docker run --rm -e CADDY_DOMAIN="$(envval CADDY_DOMAIN)" -e CADDY_WEB_DOMAIN="$(envval CADDY_WEB_DOMAIN)" \
    -e CADDY_EMAIL="$(envval CADDY_EMAIL)" -e LOAD_TEST_GENERATOR_IP="$GEN" \
    -v "$PWD/docker/caddy/Caddyfile.load-test:/etc/caddy/Caddyfile:ro" -v "$CA_DIR:/etc/caddy/load-test-ca:ro" \
    "$CADDY_IMAGE" caddy "$@" --config /etc/caddy/Caddyfile
}
check_config() { # check_config <json-file>
  docker run --rm -v "$1:/c.json:ro" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" node /lt/caddy-check.mjs /c.json "$GEN"
}

case "$MODE" in
  plan)
    warn_overrides
    lt_compose config --quiet || die "docker compose config failed"
    check_target "$PROJECT" "$RUN"
    TMP=$(mktemp)
    trap 'rm -f "$TMP"' EXIT
    adapted validate > /dev/null 2>&1 || die "caddy validate failed for Caddyfile.load-test"
    adapted adapt 2> /dev/null > "$TMP" || die "caddy adapt failed"
    check_config "$TMP"
    echo "preflight plan: ok (run $RUN, project $PROJECT, route prefix '${PREFIX}', generator $GEN)"
    ;;
  live)
    warn_overrides
    VOLUME="${PROJECT}_postgres_data_pg18"
    LABEL=$(docker volume inspect "$VOLUME" --format '{{index .Labels "org.amcore.load-test"}}' 2> /dev/null) ||
      die "volume $VOLUME not found"
    [ "$LABEL" = "$RUN" ] || die "volume $VOLUME is not labelled for run $RUN (found '$LABEL'); never adopt it"
    check_target "$PROJECT" "$RUN" running
    ACTUAL_WEB=$(docker inspect "$(lt_compose ps -q web)" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')
    [ "$ACTUAL_WEB" = "$WEB_IP" ] || die "web address $ACTUAL_WEB differs from COMPOSE_WEB_IPV4 $WEB_IP"
    TMP=$(mktemp)
    trap 'rm -f "$TMP"' EXIT
    lt_compose exec -T caddy wget -qO- http://127.0.0.1:2019/config/ > "$TMP" || die "cannot read the running Caddy config"
    check_config "$TMP"
    # Only records with a verified client certificate are test-entry requests; the same file
    # also receives :80 requests for these names (ACME validation, redirects).
    PEER=$(lt_compose exec -T caddy sh -c 'cat /data/load-test-access.log 2>/dev/null' |
      grep '"client_common_name":"[^"]' | tail -n 50 |
      sed -n 's/.*"remote_ip":"\([^"]*\)".*/\1/p' | sort -u)
    [ "$PEER" = "$GEN" ] || die "test-entry peers '$PEER' differ from $GEN; run 'admission.sh probe' from the generator first"
    echo "preflight live: ok (volume $VOLUME labelled $RUN, web $ACTUAL_WEB, generator peer $GEN)"
    ;;
  *) die "usage: preflight.sh plan|live" ;;
esac
