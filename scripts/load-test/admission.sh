#!/bin/sh
# Admission checks for the load-test entry, before any load (docs/operations/load-testing.md).
#   admission.sh probe     one valid request from the generator (for `preflight.sh live`)
#   admission.sh run       on the generator: mTLS refusals, X-Forwarded-For rules, rate buckets
#   admission.sh outside   on any other machine: :8443 refused, forged headers on :443 ignored
# Needs curl and openssl. Any FAIL exits non-zero: do not start the load.
# The rate checks spend real budgets of members 199 and 200 (and the outside address); the
# script waits for them to refill instead of clearing anything.
# shellcheck disable=SC2086 # CERT and RESOLVE are option lists, split on purpose
set -eu
. "$(dirname "$0")/lib.sh"
set -a
. "${LT_ENV:-./load-test.env}"
set +a
require_vars LT_WORK LT_WEB_HOST LT_API_HOST LT_SERVER_IP
PW=$(cat "$LT_WORK/fixture-password" 2> /dev/null || true) # needed by "run" only
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
FAILS=0
pass() { echo "PASS $*"; }
fail() {
  echo "FAIL $*"
  FAILS=$((FAILS + 1))
}
expect() { # expect <label> <wanted-code> <actual-code>
  if [ "$3" = "$2" ]; then pass "$1 ($3)"; else fail "$1 (wanted $2, got $3)"; fi
}
RESOLVE="--resolve $LT_WEB_HOST:8443:$LT_SERVER_IP --resolve $LT_API_HOST:8443:$LT_SERVER_IP --resolve $LT_WEB_HOST:443:$LT_SERVER_IP --resolve $LT_API_HOST:443:$LT_SERVER_IP"
CERT="--cert $LT_WORK/client.crt --key $LT_WORK/client.key"
API8="https://$LT_API_HOST:8443/api/v1"
WEB8="https://$LT_WEB_HOST:8443"
ORIGIN="https://$LT_WEB_HOST"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 $RESOLVE "$@" || true; }

login() { # login <jar> <member-number> <xff-or-empty> <base-url> [cert args...]
  jar=$1 n=$2 xff=$3 base=$4
  shift 4
  set -- "$@" -c "$jar" -H "Origin: $ORIGIN" -H 'content-type: application/json'
  [ -z "$xff" ] || set -- "$@" -H "X-Forwarded-For: $xff"
  code "$@" -X POST "$base/api/auth/login" -d "{\"email\":\"lt-member-$n@example.test\",\"password\":\"$PW\"}"
}

# burst <label> <count> <curl args...>: fires <count> requests 20 at a time, prints "<ok> <429>".
burst() {
  label=$1 count=$2
  shift 2
  # One numbered line per request: xargs -I skips empty lines.
  seq 1 "$count" |
    xargs -P 20 -I{} sh -c 'curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 "$@" || echo 000' sh $RESOLVE "$@" > "$TMP/$label"
  echo "$(grep -vc '^429$' "$TMP/$label") $(grep -c '^429$' "$TMP/$label")"
}
budget_hit() { # budget_hit <label> "<ok> <429>": limited after roughly the default burst of 50
  set -- "$1" $2
  if [ "$3" -gt 0 ] && [ "$2" -ge 45 ] && [ "$2" -le 75 ]; then pass "$1 limited after $2 requests"; else fail "$1: $2 admitted, $3 limited"; fi
}

case "${1:-}" in
  probe)
    expect "probe through the test entry" 200 "$(code $CERT -H 'X-Forwarded-For: 198.18.3.1' "$WEB8${LT_PREFIX:-}/login")"
    ;;
  run)
    [ -n "$PW" ] || die "LT_WORK/fixture-password is required for run"
    # 1. Mutual TLS: no certificate and a certificate from a foreign CA never reach a site.
    expect "no client certificate" 000 "$(code "$WEB8${LT_PREFIX:-}/login" -H 'X-Forwarded-For: 198.18.3.1')"
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj /CN=foreign \
      -keyout "$TMP/foreign.key" -out "$TMP/foreign.crt" 2> /dev/null
    expect "foreign-CA certificate" 000 "$(code --cert "$TMP/foreign.crt" --key "$TMP/foreign.key" -H 'X-Forwarded-For: 198.18.3.1' "$WEB8${LT_PREFIX:-}/login")"
    # A name that is not a test site must not reach a site without the client certificate.
    # TLS failure (000) or 421 Misdirected Request (strict_sni_host) are both refusals.
    got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -k --resolve "unknown.invalid:8443:$LT_SERVER_IP" \
      -H "Host: $LT_WEB_HOST" -H 'X-Forwarded-For: 198.18.3.1' "https://unknown.invalid:8443/" || true)
    case "$got" in 000 | 421) pass "other TLS name with a site Host header ($got)" ;; *) fail "other TLS name reached a site ($got)" ;; esac
    # 2. Exactly one synthetic IPv4 visitor address per request.
    for xff in '' '203.0.113.9' '198.18.0.1, 198.18.0.2' '198.20.0.1' '2001:db8::1' 'garbage'; do
      if [ -n "$xff" ]; then got=$(code $CERT -H "X-Forwarded-For: $xff" "$API8/auth/me"); else got=$(code $CERT "$API8/auth/me"); fi
      expect "X-Forwarded-For '${xff:-<missing>}' refused" 400 "$got"
    done
    expect "two X-Forwarded-For headers refused" 400 "$(code $CERT -H 'X-Forwarded-For: 198.18.0.1' -H 'X-Forwarded-For: 198.18.0.2' "$API8/auth/me")"
    # 3. API: one identity is limited at the default budget, another identity is not;
    #    a forged claim header changes nothing.
    budget_hit "API identity 198.18.3.10" "$(burst api-a 90 $CERT -H 'X-Forwarded-For: 198.18.3.10' "$API8/auth/me")"
    expect "API other identity unaffected" 401 "$(code $CERT -H 'X-Forwarded-For: 198.18.3.11' "$API8/auth/me")"
    expect "API claim header ignored" 429 "$(code $CERT -H 'X-Forwarded-For: 198.18.3.10' -H 'X-AMCore-Client-Ip: 198.18.3.12' -H 'X-Real-IP: 198.18.3.12' "$API8/auth/me")"
    # 4. Through the web app: two members, two addresses, two buckets.
    expect "member 199 sign-in" 200 "$(login "$TMP/jar199" 199 198.18.0.199 "$WEB8" $CERT)"
    expect "member 200 sign-in" 200 "$(login "$TMP/jar200" 200 198.18.0.200 "$WEB8" $CERT)"
    budget_hit "web identity 198.18.0.199" "$(burst bff-a 90 $CERT -b "$TMP/jar199" -H "Origin: $ORIGIN" -H 'X-Forwarded-For: 198.18.0.199' "$WEB8/api/auth/me")"
    expect "web other identity unaffected" 200 "$(code $CERT -b "$TMP/jar200" -H "Origin: $ORIGIN" -H 'X-Forwarded-For: 198.18.0.200' "$WEB8/api/auth/me")"
    expect "web claim header ignored" 429 "$(code $CERT -b "$TMP/jar199" -H "Origin: $ORIGIN" -H 'X-Forwarded-For: 198.18.0.199' -H 'X-AMCore-Client-Ip: 198.18.0.201' -H 'X-Real-IP: 198.18.0.201' "$WEB8/api/auth/me")"
    ;;
  outside)
    expect "test entry without certificate" 000 "$(code -H 'X-Forwarded-For: 198.18.3.1' "$WEB8${LT_PREFIX:-}/login")"
    # Normal edge: every request forges another visitor in all three headers; one bucket.
    budget_hit "normal edge API ignores forged headers" "$(burst edge-api 90 -H 'X-Forwarded-For: 198.18.4.7' -H 'X-Real-IP: 198.18.4.8' -H 'X-AMCore-Client-Ip: 198.18.4.9' "https://$LT_API_HOST/api/v1/auth/me")"
    expect "normal edge API, other forged address, same bucket" 429 "$(code -H 'X-Forwarded-For: 198.18.4.70' -H 'X-AMCore-Client-Ip: 198.18.4.71' "https://$LT_API_HOST/api/v1/auth/me")"
    ;;
  *) die "usage: admission.sh probe|run|outside" ;;
esac

if [ "$FAILS" -gt 0 ]; then die "$FAILS admission check(s) failed: do not start the load"; fi
if [ "${1:-}" != probe ]; then
  echo "admission: all checks passed; waiting 90 s for the spent rate budgets to refill"
  sleep 90
fi
