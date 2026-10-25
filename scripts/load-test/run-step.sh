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

# Clock offset over ONE established SSH session: the host answers each line with its clock,
# so its timestamp lies between sending (t0) and receiving (t1). Offset = host - midpoint,
# with a proven error of at most (t1 - t0) / 2; the shortest of five exchanges counts. The
# SSH connection setup is outside the timed exchanges (a busy host's slow setup was once
# reported as skew), and delays before or after the host's timestamp only widen the bound.
clock_offset() {
  fifo=$(mktemp -d)
  mkfifo "$fifo/in" "$fifo/out"
  timeout 60 ssh -o BatchMode=yes -o ConnectTimeout=20 "$LT_SERVER_SSH" \
    'while read -r _; do date +%s%3N; done' < "$fifo/in" > "$fifo/out" 2> /dev/null &
  exec 3> "$fifo/in" 4< "$fifo/out"
  if ! { echo >&3 && read -r _ <&4; }; then die "clock: no answer from the host"; fi
  span=
  for _ in 1 2 3 4 5; do
    t0=$(ms)
    echo >&3
    read -r remote <&4 || die "clock: the host connection closed"
    t1=$(ms)
    if [ -z "$span" ] || [ $((t1 - t0)) -lt "$span" ]; then
      span=$((t1 - t0))
      offset=$((remote - (t0 + t1) / 2))
    fi
  done
  exec 3>&- 4<&-
  wait 2> /dev/null || true
  rm -rf "$fifo"
  bound=$(((span + 1) / 2))
}
clock_offset
json_s() { awk -v v="$1" 'BEGIN {printf "%.3f", v / 1000}'; }
echo "{\"skewS\":$(json_s "$offset"),\"skewUncertaintyS\":$(json_s "$bound")}" > "$DIR/clock.json"
# Accept only when the whole interval offset ± bound lies within 1 s: a larger offset is
# skew; a large bound means the clock could not be measured precisely enough.
[ $((${offset#-} + bound)) -le 1000 ] ||
  die "clock offset to the host is ${offset} ± ${bound} ms, not provably within 1 s; synchronise time (NTP) or check the generator-host connection"

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

# The exact window boundaries go to the server statistics (no rounding). The raw logs are
# fetched and the statistics computed here on the generator, never on the measured host.
WINDOW=$(sed -n 's/.*"start":\([0-9.]*\),"end":\([0-9.]*\).*/\1 \2/p' "$DIR/window.json" 2> /dev/null || true)
mkdir -p "$DIR/logs"
# Three separate stages, each with its own status (a pipeline would report only tar's):
# fetch the archive, unpack it, compute. A failure of any stage leaves server.err, and the
# step is invalid even if part of the data arrived.
stats_failed() {
  rm -f "$DIR/server.json"
  echo "$1" >> "$DIR/server.err"
}
: > "$DIR/server.err"
# shellcheck disable=SC2086 # WINDOW is "<from> <to>", two arguments
if [ -z "$WINDOW" ]; then
  stats_failed "measured window unavailable"
elif ! srv sh scripts/load-test/server-stats.sh logs > "$DIR/logs.tar" 2>> "$DIR/server.err"; then
  stats_failed "fetching the host access logs failed"
elif ! tar xf "$DIR/logs.tar" -C "$DIR/logs" 2>> "$DIR/server.err"; then
  stats_failed "the fetched access-log archive is incomplete or corrupt"
elif ! docker run --rm -v "$DIR/logs:/logs:ro" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" node /lt/stats.mjs /logs $WINDOW > "$DIR/server.json" 2>> "$DIR/server.err"; then
  stats_failed "computing the server statistics failed"
else
  rm -rf "$DIR/server.err" "$DIR/logs" "$DIR/logs.tar"
fi
docker run --rm -v "$DIR:/d" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" sh -c 'node /lt/classify.mjs /d > /d/result.json' ||
  die "classification failed for step $NAME"
docker run --rm -v "$DIR:/d:ro" "$NODE_IMAGE" node -e \
  'const r=JSON.parse(require("fs").readFileSync("/d/result.json"));const f=r.figures;console.log(`'"$NAME"': ${r.class}; offered ${f.offeredRate} it/s, achieved ${f.achievedRate?.toFixed(2)} it/s, server p95 ${Math.round(f.serverP95Ms ?? NaN)} ms${r.reasons.length ? "; " + r.reasons.join("; ") : ""}`)'
