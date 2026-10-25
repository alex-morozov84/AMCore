#!/bin/sh
# One load step (generator VM, in an AMCore checkout of the measured commit).
#   run-step.sh <name> <rate it/s> <seconds>
# Needs the generator env file (docs/operations/load-testing.md) in LT_ENV, default
# ./load-test.env, and LT_WORK holding client.crt, client.key, fixture-password and
# sessions.json from prepare. Result: $LT_WORK/<out>/steps/<name>/result.json, where <out>
# is out-smoke with LT_SMOKE=1 and out otherwise.
# Every component keeps its exit status; a missing fact makes the step invalid, never 0.
set -eu
. "$(dirname "$0")/lib.sh"
NAME=${1:?step name} RATE=${2:?rate} SECONDS_=${3:?seconds}
set -a
. "${LT_ENV:-./load-test.env}"
set +a
require_vars LT_WORK LT_SERVER_SSH LT_SERVER_DIR LT_WEB_HOST LT_API_HOST LT_SERVER_IP
echo "$NAME" | grep -Eq '^[a-z0-9-]+$' || die "step name must be lowercase letters, digits and dashes"
[ "${LT_SMOKE:-0}" = 1 ] && OUT=out-smoke || OUT=out
DIR="$LT_WORK/$OUT/steps/$NAME"
REMOTE="\$HOME/amcore-load-test/$NAME"
[ ! -e "$DIR" ] || die "step $NAME already exists; use a new name"
mkdir -p "$DIR"

# Every remote command is bounded; a lost connection fails the call instead of hanging.
srv() { timeout 120 ssh -o BatchMode=yes -o ConnectTimeout=20 "$LT_SERVER_SSH" "cd '$LT_SERVER_DIR' && $*"; }
ms() { date +%s%3N; }

GEN_PID=
cleanup() {
  [ -z "$GEN_PID" ] || kill "$GEN_PID" 2> /dev/null || true
  srv sh scripts/load-test/sampler.sh stop "$REMOTE" > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Clock skew in seconds, measured against the middle of the round trip.
t0=$(ms)
remote=$(srv sh scripts/load-test/server-stats.sh clock)
t1=$(ms)
skew_ms=$((remote - (t0 + t1) / 2))
echo "{\"skewS\":$(awk -v v="$skew_ms" 'BEGIN {printf "%.3f", v / 1000}')}" > "$DIR/clock.json"
[ "${skew_ms#-}" -le 1000 ] || die "clock skew to the host is ${skew_ms} ms; synchronise time (NTP) first"

srv sh scripts/load-test/server-stats.sh containers > "$DIR/containers.before"
srv sh scripts/load-test/sampler.sh start "$REMOTE"
# Generator CPU: "<epoch> idle=<percent>" every 5 s from vmstat's "id" column.
(
  exec < /dev/null > "$DIR/generator.txt" 2> /dev/null
  while :; do
    printf '%s ' "$(now)"
    vmstat 1 2 | awk 'NR == 2 {for (i = 1; i <= NF; i++) if ($i == "id") c = i} END {print "idle=" $c}'
    sleep 4
  done
) &
GEN_PID=$!

set +e
timeout $((SECONDS_ + 180)) docker run --rm --network host --user "$(id -u):$(id -g)" -v "$LT_WORK:/work" -v "$LT_DIR:/lt:ro" \
  "$K6_IMAGE" run --quiet --include-system-env-vars=false \
  -e LT_WEB_HOST="$LT_WEB_HOST" -e LT_API_HOST="$LT_API_HOST" -e LT_SERVER_IP="$LT_SERVER_IP" -e LT_PREFIX="${LT_PREFIX:-}" \
  -e LT_RATE="$RATE" -e LT_DURATION="${SECONDS_}s" -e LT_STEP="$NAME" -e LT_SMOKE="${LT_SMOKE:-0}" \
  /lt/k6/mixed.js > "$DIR/k6.log" 2>&1
echo $? > "$DIR/k6.exit"
kill "$GEN_PID" 2> /dev/null
GEN_PID=
srv sh scripts/load-test/sampler.sh stop "$REMOTE" > /dev/null 2>&1
srv cat "$REMOTE/sampler.exit" > "$DIR/sampler.exit" 2> /dev/null || echo 1 > "$DIR/sampler.exit"
srv cat "$REMOTE/samples.txt" > "$DIR/samples.txt"
srv sh scripts/load-test/server-stats.sh containers > "$DIR/containers.after"
mv "$LT_WORK/$OUT/$NAME.summary.json" "$DIR/summary.json" 2> /dev/null
mv "$LT_WORK/$OUT/$NAME.window.json" "$DIR/window.json" 2> /dev/null
set -e

# The exact window boundaries go to the server statistics (no rounding).
WINDOW=$(sed -n 's/.*"start":\([0-9.]*\),"end":\([0-9.]*\).*/\1 \2/p' "$DIR/window.json" 2> /dev/null || true)
# shellcheck disable=SC2086 # WINDOW is "<from> <to>", two arguments
if [ -n "$WINDOW" ] && srv sh scripts/load-test/server-stats.sh window $WINDOW > "$DIR/server.json" 2> "$DIR/server.err"; then
  rm -f "$DIR/server.err"
else
  rm -f "$DIR/server.json"
  [ -s "$DIR/server.err" ] || echo "measured window or server stats unavailable" > "$DIR/server.err"
fi
docker run --rm -v "$DIR:/d" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" sh -c 'node /lt/classify.mjs /d > /d/result.json' ||
  die "classification failed for step $NAME"
docker run --rm -v "$DIR:/d:ro" "$NODE_IMAGE" node -e \
  'const r=JSON.parse(require("fs").readFileSync("/d/result.json"));const f=r.figures;console.log(`'"$NAME"': ${r.class}; offered ${f.offeredRate} it/s, achieved ${f.achievedRate?.toFixed(2)} it/s, server p95 ${Math.round(f.serverP95Ms ?? NaN)} ms${r.reasons.length ? "; " + r.reasons.join("; ") : ""}`)'
