#!/bin/sh
# One load step (generator VM, in an AMCore checkout of the measured commit).
#   run-step.sh <name> <rate it/s> <seconds>
# Needs the generator env file (docs/operations/load-testing.md) in LT_ENV, default
# ./load-test.env, and LT_WORK holding client.crt, client.key, fixture-password and
# sessions.json from prepare. Result: $LT_WORK/out/steps/<name>/result.json.
# Every component keeps its exit status; a missing fact makes the step invalid, never 0.
set -eu
. "$(dirname "$0")/lib.sh"
NAME=${1:?step name} RATE=${2:?rate} SECONDS_=${3:?seconds}
set -a
. "${LT_ENV:-./load-test.env}"
set +a
require_vars LT_WORK LT_SERVER_SSH LT_SERVER_DIR LT_WEB_HOST LT_API_HOST LT_SERVER_IP
echo "$NAME" | grep -Eq '^[a-z0-9-]+$' || die "step name must be lowercase letters, digits and dashes"
DIR="$LT_WORK/out/steps/$NAME"
REMOTE="\$HOME/amcore-load-test/$NAME"
[ ! -e "$DIR" ] || die "step $NAME already exists; use a new name"
mkdir -p "$DIR"

srv() { ssh -o BatchMode=yes -o ConnectTimeout=20 "$LT_SERVER_SSH" "cd '$LT_SERVER_DIR' && $*"; }

skew=$(($(srv sh scripts/load-test/server-stats.sh clock) - $(now)))
[ "${skew#-}" -le 1 ] || die "clock skew to the host is ${skew} s; synchronise time (NTP) first"

srv sh scripts/load-test/server-stats.sh containers > "$DIR/containers.before"
srv sh scripts/load-test/sampler.sh start "$REMOTE"
vmstat 5 > "$DIR/generator-vmstat.txt" &
VMSTAT=$!

set +e
timeout $((SECONDS_ + 180)) docker run --rm --network host --user "$(id -u):$(id -g)" -v "$LT_WORK:/work" -v "$LT_DIR:/lt:ro" \
  "$K6_IMAGE" run --quiet --include-system-env-vars=false \
  -e LT_WEB_HOST="$LT_WEB_HOST" -e LT_API_HOST="$LT_API_HOST" -e LT_SERVER_IP="$LT_SERVER_IP" -e LT_PREFIX="${LT_PREFIX:-}" \
  -e LT_RATE="$RATE" -e LT_DURATION="${SECONDS_}s" -e LT_STEP="$NAME" -e LT_SMOKE="${LT_SMOKE:-0}" \
  /lt/k6/mixed.js > "$DIR/k6.log" 2>&1
echo $? > "$DIR/k6.exit"
kill "$VMSTAT" 2> /dev/null
srv sh scripts/load-test/sampler.sh stop "$REMOTE" > /dev/null 2>&1
srv cat "$REMOTE/sampler.exit" > "$DIR/sampler.exit" 2> /dev/null || echo 1 > "$DIR/sampler.exit"
srv cat "$REMOTE/samples.txt" > "$DIR/samples.txt"
srv sh scripts/load-test/server-stats.sh containers > "$DIR/containers.after"
mv "$LT_WORK/out/$NAME.summary.json" "$DIR/summary.json" 2> /dev/null
mv "$LT_WORK/out/$NAME.window.json" "$DIR/window.json" 2> /dev/null
set -e

WINDOW=$(docker run --rm -v "$DIR:/d:ro" "$NODE_IMAGE" node -e \
  'const w=JSON.parse(require("fs").readFileSync("/d/window.json"));console.log(Math.floor(w.start), Math.ceil(w.end))' 2> /dev/null || true)
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
