#!/bin/sh
# Reference load protocol (generator VM, AMCore checkout of the measured commit).
#   protocol.sh prepare    sign in the 200 members once (writes $LT_WORK/sessions.json, live cookies)
#   protocol.sh smoke      every action once at 2 it/s for 20 s into $LT_WORK/out-smoke; not
#                          the reference protocol, and it never blocks a later campaign
#   protocol.sh campaign   the frozen protocol below into $LT_WORK/out, then report.mjs
# Frozen protocol: warm-up 60 s at 5 it/s (reported, not compared); steps 5, 10, 20, 30, 40
# it/s, 120 s each, three repeats, 30 s gaps; admin 0.2 it/s. A warm-up that is not "valid"
# stops before the ladder; the first repeat that is not "valid" stops the ladder; then
# 120 s idle and a 5 it/s control step. Do not change these values between compared runs.
set -eu
. "$(dirname "$0")/lib.sh"
set -a
. "${LT_ENV:-./load-test.env}"
set +a
require_vars LT_WORK LT_SERVER_SSH LT_SERVER_DIR LT_WEB_HOST LT_API_HOST LT_SERVER_IP
RATES='5 10 20 30 40'
REPEATS=3
STEP_SECONDS=120
step() { sh "$LT_DIR/run-step.sh" "$@"; }
class_of() { sed -n 's/.*"class":"\([^"]*\)".*/\1/p' "$OUT/steps/$1/result.json" 2> /dev/null; }
harness_sha() (cd "$LT_DIR" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1)

record_recovery() {
  cat > "$OUT/RECOVERY.txt" << EOF
Started $(date -u +%Y-%m-%dT%H:%M:%SZ) on the generator. If this run stops for any reason
(Ctrl-C, k6 or sampler crash, lost SSH), remove the test entry on the host, then prove it:
  ssh $LT_SERVER_SSH "cd '$LT_SERVER_DIR' && sh scripts/load-test/recover.sh"
  ssh $LT_SERVER_SSH "cd '$LT_SERVER_DIR' && sh scripts/load-test/remove-check.sh"
Nothing is cleaned up automatically after a lost connection.
EOF
  cat "$OUT/RECOVERY.txt"
}

# Non-secret identity of the run: both sides' commit and harness hash, sizes, parameters.
record_manifest() {
  timeout 120 ssh -o BatchMode=yes -o ConnectTimeout=20 "$LT_SERVER_SSH" \
    "cd '$LT_SERVER_DIR' && sh scripts/load-test/server-stats.sh manifest" > "$OUT/host-manifest.txt" ||
    die "cannot record the host manifest"
  {
    echo "commit=$(git -C "$LT_DIR" rev-parse HEAD 2> /dev/null || echo unknown)"
    echo "harness_sha256=$(harness_sha)"
    echo "avatar_sha256=$(sha256sum "$LT_DIR/k6/avatar.png" | cut -d' ' -f1)"
    echo "cpus=$(nproc)"
    echo "mem_total_mib=$(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
    echo "k6_image=$K6_IMAGE"
    echo "protocol=warmup 5 it/s 60 s; rates $RATES it/s; $REPEATS repeats of $STEP_SECONDS s; gaps 30 s; admin 0.2 it/s; 200 members; control 5 it/s after 120 s idle"
  } > "$OUT/generator-manifest.txt"
}

report() { docker run --rm -v "$OUT:/out" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" node /lt/report.mjs /out "$1"; }

case "${1:-}" in
  prepare)
    [ ! -e "$LT_WORK/sessions.json" ] || die "sessions.json exists; remove it to sign in again"
    docker run --rm --network host --user "$(id -u):$(id -g)" -v "$LT_WORK:/work" -v "$LT_DIR:/lt:ro" \
      "$K6_IMAGE" run --quiet --include-system-env-vars=false \
      -e LT_WEB_HOST="$LT_WEB_HOST" -e LT_API_HOST="$LT_API_HOST" -e LT_SERVER_IP="$LT_SERVER_IP" -e LT_PREFIX="${LT_PREFIX:-}" \
      /lt/k6/prepare.js || die "prepare failed"
    ;;
  smoke)
    OUT="$LT_WORK/out-smoke"
    mkdir -p "$OUT"
    record_recovery
    record_manifest
    LT_SMOKE=1 step "smoke-$(now)" 2 20 || true
    report smoke
    ;;
  campaign)
    OUT="$LT_WORK/out"
    [ ! -e "$OUT/steps" ] || die "$OUT/steps exists; keep it and start the next campaign with a new LT_WORK"
    mkdir -p "$OUT"
    record_recovery
    record_manifest
    step warmup 5 60 || true
    stopped=
    if [ "$(class_of warmup)" != valid ]; then
      stopped=warmup
    else
      for rate in $RATES; do
        for repeat in $(seq 1 "$REPEATS"); do
          sleep 30
          name="r$rate-$repeat"
          step "$name" "$rate" "$STEP_SECONDS" || true
          if [ "$(class_of "$name")" != valid ]; then
            stopped="$name"
            break 2
          fi
        done
      done
    fi
    if [ "$stopped" = warmup ]; then
      echo "protocol: the warm-up is $(class_of warmup || true), so no step was measured; see its reasons"
    else
      [ -z "$stopped" ] || echo "protocol: stopped after $stopped ($(class_of "$stopped"))"
      sleep 120
      step control 5 "$STEP_SECONDS" || true
    fi
    report campaign
    ;;
  *) die "usage: protocol.sh prepare|smoke|campaign" ;;
esac
