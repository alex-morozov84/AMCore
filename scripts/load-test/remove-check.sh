#!/bin/sh
# Prove the load-test entry is gone (host, deployment checkout). An unfinished or failed
# check means the cleanup is unfinished.
#   remove-check.sh   effective config and the open ports seen from this host
# When the generator is reachable, also prove it there (the firewall admits only it on 8443):
#   sh scripts/load-test/admission.sh removed
# (8443 a closed port, the normal edge answering and ignoring forged address headers).
# shellcheck disable=SC2016,SC2034 # check() evaluates its condition later, on purpose
set -eu
. "$(dirname "$0")/lib.sh"
[ -f .env ] || die "run from the deployment checkout"
FAILS=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; FAILS=$((FAILS + 1)); fi; }
FILES=$(envval COMPOSE_FILE)
WEB=$(envval CADDY_WEB_DOMAIN)
check "COMPOSE_FILE has no load-test overlay" '! echo ":$FILES:" | grep -q ":docker/compose/load-test.yml:"'
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
lt_compose exec -T caddy wget -qO- http://127.0.0.1:2019/config/ > "$TMP" || die "cannot read the running Caddy config"
check "running Caddy has no :8443 server" '! grep -q ":8443" "$TMP"'
check "running Caddy has no trusted_proxies" '! grep -q "trusted_proxies" "$TMP"'
check "Caddy publishes no port 8443" '! lt_compose port caddy 8443 > /dev/null 2>&1'
check "normal HTTPS answers on :443" '[ "$(curl -s -o /dev/null -w "%{http_code}" -m 15 --resolve "$WEB:443:127.0.0.1" "https://$WEB/")" != 000 ]'
# curl exit 7 is "connection refused": a closed port. A TLS refusal by the test entry
# (no client certificate) is another code and fails this check.
check ":8443 refuses connections" 'curl -s -o /dev/null -m 15 -k --resolve "$WEB:8443:127.0.0.1" "https://$WEB:8443/"; [ $? -eq 7 ]'
[ "$FAILS" -eq 0 ] || die "$FAILS removal check(s) failed: the test entry may still be open"
echo "remove-check: the test entry is removed; run the two curl checks from another machine too"
