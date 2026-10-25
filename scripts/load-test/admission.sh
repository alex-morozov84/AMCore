#!/bin/sh
# Admission and removal checks for the load-test entry (docs/operations/load-testing.md).
#   admission.sh probe     one valid request from the generator (for `preflight.sh live`)
#   admission.sh run       on the generator, before any load: mTLS refusals on both test
#                          domains, X-Forwarded-For rules, separate rate buckets
#   admission.sh outside   from a machine that is not the generator, before any load: the
#                          test entry is refused, forged headers on the normal edge are ignored
#   admission.sh removed   on the generator, after recover.sh: 8443 is a closed port, the
#                          normal edge answers and still ignores forged headers
# Needs curl and openssl, and LT_WORK/fixture-password (members 197–200 sign in). Without
# LT_SERVER_IP the names resolve through public DNS (for a machine outside the network).
# Any FAIL exits non-zero. The rate checks spend real budgets; the script then waits for
# them to refill instead of clearing anything.
# shellcheck disable=SC2086 # CERT and RESOLVE are option lists, split on purpose
set -eu
. "$(dirname "$0")/lib.sh"
set -a
. "${LT_ENV:-./load-test.env}"
set +a
require_vars LT_WORK LT_WEB_HOST LT_API_HOST
MODE=${1:-}
PW=$(cat "$LT_WORK/fixture-password" 2> /dev/null || true)
[ "$MODE" = probe ] || [ -n "$PW" ] || die "LT_WORK/fixture-password is required"
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
RESOLVE=
[ -z "${LT_SERVER_IP:-}" ] || for h in "$LT_WEB_HOST" "$LT_API_HOST"; do
  RESOLVE="$RESOLVE --resolve $h:8443:$LT_SERVER_IP --resolve $h:443:$LT_SERVER_IP"
done
CERT="--cert $LT_WORK/client.crt --key $LT_WORK/client.key"
API8="https://$LT_API_HOST:8443/api/v1"
WEB8="https://$LT_WEB_HOST:8443"
ORIGIN="https://$LT_WEB_HOST"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 20 $RESOLVE "$@" || true; }

login() { # login <jar> <member-number> <base-url> [curl args...]
  jar=$1 n=$2 base=$3
  shift 3
  code "$@" -c "$jar" -H "Origin: $ORIGIN" -H 'content-type: application/json' \
    -X POST "$base/api/auth/login" -d "{\"email\":\"lt-member-$n@example.test\",\"password\":\"$PW\"}"
}

# burst <label> <count> <curl args...>: fires <count> requests 20 at a time; one status per line.
burst() {
  label=$1 count=$2
  shift 2
  # One numbered line per request: xargs -I skips empty lines.
  seq 1 "$count" |
    xargs -P 20 -I{} sh -c 'curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 "$@" || echo 000' sh $RESOLVE "$@" > "$TMP/$label"
}
# budget_hit <label> <expected-code>: the burst was admitted with the expected status about
# the default burst of 50 times, then limited with 429; any other status fails the check.
budget_hit() {
  ok=$(grep -c "^$2\$" "$TMP/$1" || true)
  limited=$(grep -c '^429$' "$TMP/$1" || true)
  other=$(grep -vc -e "^$2\$" -e '^429$' "$TMP/$1" || true)
  if [ "$other" -eq 0 ] && [ "$limited" -gt 0 ] && [ "$ok" -ge 45 ] && [ "$ok" -le 75 ]; then
    pass "$1: limited after $ok × $2"
  else
    fail "$1: $ok × $2, $limited × 429, $other other"
  fi
}

# still_limited <label> <expected-code>: right after a spent budget, a short burst stays
# limited. Refill allows a few admissions (100/min), a fresh bucket would admit all ten.
still_limited() {
  ok=$(grep -c "^$2\$" "$TMP/$1" || true)
  limited=$(grep -c '^429$' "$TMP/$1" || true)
  other=$(grep -vc -e "^$2\$" -e '^429$' "$TMP/$1" || true)
  if [ "$other" -eq 0 ] && [ "$limited" -ge 5 ] && [ "$ok" -le 5 ]; then
    pass "$1: same bucket ($limited × 429, $ok × $2 from refill)"
  else
    fail "$1: $ok × $2, $limited × 429, $other other — forged headers chose another bucket?"
  fi
}

# Normal edge (:443): forged visitor headers must not choose the rate-limit bucket. The API
# reads me through the same handler whether a client calls it directly or through the web
# app, so both paths may share one bucket per real address: the web check therefore starts
# only after the API bucket refilled (default burst 50 at 100/min: full again within 30 s).
REFILL_S=${LT_REFILL_S:-45} # tests shorten it
edge_spoof() {
  F='-H X-Forwarded-For:198.18.4.7 -H X-Real-IP:198.18.4.8 -H X-AMCore-Client-Ip:198.18.4.9'
  G='-H X-Forwarded-For:198.18.4.70 -H X-Real-IP:198.18.4.71 -H X-AMCore-Client-Ip:198.18.4.72'
  burst edge-api 90 $F "https://$LT_API_HOST/api/v1/auth/me"
  burst edge-api-other 10 $G "https://$LT_API_HOST/api/v1/auth/me"
  budget_hit edge-api 401
  still_limited edge-api-other 401
  expect "member 197 sign-in on the normal edge" 200 "$(login "$TMP/jar197" 197 "https://$LT_WEB_HOST")"
  echo "admission: waiting ${REFILL_S} s for the shared budget to refill before the web app check"
  sleep "$REFILL_S"
  burst edge-web 90 -b "$TMP/jar197" -H "Origin: $ORIGIN" $F "https://$LT_WEB_HOST/api/auth/me"
  burst edge-web-other 10 -b "$TMP/jar197" -H "Origin: $ORIGIN" $G "https://$LT_WEB_HOST/api/auth/me"
  budget_hit edge-web 200
  still_limited edge-web-other 200
}

refusals() { # mTLS on one test domain: no certificate and a foreign CA never reach a site
  url=$1
  expect "$url without client certificate" 000 "$(code -H 'X-Forwarded-For: 198.18.3.1' "$url")"
  expect "$url with a foreign-CA certificate" 000 "$(code --cert "$TMP/foreign.crt" --key "$TMP/foreign.key" -H 'X-Forwarded-For: 198.18.3.1' "$url")"
}

case "$MODE" in
  probe)
    require_vars LT_SERVER_IP
    expect "probe through the test entry" 200 "$(code $CERT -H 'X-Forwarded-For: 198.18.3.1' "$WEB8${LT_PREFIX:-}/login")"
    ;;
  run)
    require_vars LT_SERVER_IP
    openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -days 1 -subj /CN=foreign \
      -keyout "$TMP/foreign.key" -out "$TMP/foreign.crt" 2> /dev/null
    refusals "$WEB8${LT_PREFIX:-}/login"
    refusals "$API8/auth/me"
    # A name that is not a test site must not reach a site: TLS failure (000) or 421
    # Misdirected Request (strict_sni_host) are both refusals, for either Host header.
    for host in "$LT_WEB_HOST" "$LT_API_HOST"; do
      got=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -k --resolve "unknown.invalid:8443:$LT_SERVER_IP" \
        -H "Host: $host" -H 'X-Forwarded-For: 198.18.3.1' "https://unknown.invalid:8443/" || true)
      case "$got" in 000 | 421) pass "other TLS name with Host $host ($got)" ;; *) fail "other TLS name reached $host ($got)" ;; esac
    done
    # Exactly one synthetic IPv4 visitor address per request.
    for xff in '' '203.0.113.9' '198.18.0.1, 198.18.0.2' '198.20.0.1' '2001:db8::1' 'garbage'; do
      if [ -n "$xff" ]; then got=$(code $CERT -H "X-Forwarded-For: $xff" "$API8/auth/me"); else got=$(code $CERT "$API8/auth/me"); fi
      expect "X-Forwarded-For '${xff:-<missing>}' refused" 400 "$got"
    done
    expect "two X-Forwarded-For headers refused" 400 "$(code $CERT -H 'X-Forwarded-For: 198.18.0.1' -H 'X-Forwarded-For: 198.18.0.2' "$API8/auth/me")"
    # API: one identity is limited at the default budget, another is not; claims change nothing.
    # A claim burst right after the spent budget: ignored claims meet that bucket (mostly
    # 429), an honoured claim would get a fresh one (all admitted). A single request cannot
    # tell, because refill (100/min) may admit it (fresh host: one 401 after the burst).
    burst api-a 90 $CERT -H 'X-Forwarded-For: 198.18.3.10' "$API8/auth/me"
    burst api-claim 10 $CERT -H 'X-Forwarded-For: 198.18.3.10' -H 'X-AMCore-Client-Ip: 198.18.3.12' -H 'X-Real-IP: 198.18.3.12' "$API8/auth/me"
    budget_hit api-a 401
    still_limited api-claim 401
    expect "API other identity unaffected" 401 "$(code $CERT -H 'X-Forwarded-For: 198.18.3.11' "$API8/auth/me")"
    # Web app: two members, two addresses, two buckets.
    expect "member 199 sign-in" 200 "$(login "$TMP/jar199" 199 "$WEB8" $CERT -H 'X-Forwarded-For: 198.18.0.199')"
    expect "member 200 sign-in" 200 "$(login "$TMP/jar200" 200 "$WEB8" $CERT -H 'X-Forwarded-For: 198.18.0.200')"
    burst bff-a 90 $CERT -b "$TMP/jar199" -H "Origin: $ORIGIN" -H 'X-Forwarded-For: 198.18.0.199' "$WEB8/api/auth/me"
    burst bff-claim 10 $CERT -b "$TMP/jar199" -H "Origin: $ORIGIN" -H 'X-Forwarded-For: 198.18.0.199' -H 'X-AMCore-Client-Ip: 198.18.0.201' -H 'X-Real-IP: 198.18.0.201' "$WEB8/api/auth/me"
    budget_hit bff-a 200
    still_limited bff-claim 200
    expect "web other identity unaffected" 200 "$(code $CERT -b "$TMP/jar200" -H "Origin: $ORIGIN" -H 'X-Forwarded-For: 198.18.0.200' "$WEB8/api/auth/me")"
    ;;
  outside)
    # From here the firewall may drop 8443 (a timeout) or Caddy may refuse the missing
    # certificate; both are refusals. The mTLS proof itself is `run` on the generator.
    expect "test entry from outside" 000 "$(code -H 'X-Forwarded-For: 198.18.3.1' "$WEB8${LT_PREFIX:-}/login")"
    edge_spoof
    ;;
  removed)
    require_vars LT_SERVER_IP
    # curl exit 7 = connection refused: a closed listener, not a lost host (the normal edge
    # answers below) and not a TLS refusal by a still running test entry.
    rc=0
    curl -s -o /dev/null --max-time 20 $RESOLVE "$WEB8/" || rc=$?
    expect "8443 is a closed port (curl exit)" 7 "$rc"
    expect "normal edge answers" 200 "$(code "https://$LT_WEB_HOST${LT_PREFIX:-}/login")"
    edge_spoof
    ;;
  *) die "usage: admission.sh probe|run|outside|removed" ;;
esac

if [ "$FAILS" -gt 0 ]; then die "$FAILS check(s) failed"; fi
if [ "$MODE" != probe ]; then
  echo "admission: all checks passed; waiting $((REFILL_S * 2)) s for the spent rate budgets to refill"
  sleep $((REFILL_S * 2))
fi
