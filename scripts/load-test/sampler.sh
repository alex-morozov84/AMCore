#!/bin/sh
# Host sampler for one load step (host, deployment checkout).
#   sampler.sh start <dir>   samples every 5 s into <dir>/samples.txt
#   sampler.sh stop <dir>    stops it; writes <dir>/sampler.exit (0 only when it ran throughout)
# Lines: "<epoch> host avail=<MiB>", "<epoch> ctr <name> <mem> <cpu>", "<epoch> vmstat <row>".
# A source that fails or hangs (each call is bounded) ends the sampler; classify.mjs also
# checks that host samples cover the whole measured window.
set -eu
. "$(dirname "$0")/lib.sh"
CMD=${1:-}
DIR=${2:-}
[ -n "$DIR" ] || die "usage: sampler.sh start|stop <dir>"
INTERVAL=${LT_SAMPLE_INTERVAL:-5} # tests shorten it
MEMINFO=${LT_MEMINFO:-/proc/meminfo} # tests point this at a fixture

sample() {
  while :; do
    ts=$(now)
    avail=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' "$MEMINFO")
    [ -n "$avail" ] || exit 11
    # Each source runs alone first, so its own exit status counts (a pipeline would
    # report only the last command's status).
    ids=$(lt_compose ps -q) || exit 12
    [ -n "$ids" ] || exit 12
    # shellcheck disable=SC2086 # one argument per container id
    stats=$(timeout 20 docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' $ids) || exit 13
    cpu=$(timeout 20 vmstat 1 2) || exit 14
    echo "$ts host avail=$avail"
    printf '%s\n' "$stats" | sed "s/^/$ts ctr /"
    printf '%s\n' "$cpu" | tail -n 1 | sed "s/^ */$ts vmstat /"
    sleep "$INTERVAL"
  done
}

case "$CMD" in
  start)
    mkdir -p "$DIR"
    : > "$DIR/samples.txt"
    rm -f "$DIR/sampler.exit"
    # No descriptor tied to the caller, so an SSH session returns at once. `exec` in a
    # subshell replaces the descriptors; redirecting the function call itself would make
    # the shell keep saved copies of the session's stdout and stderr open.
    (
      exec < /dev/null >> "$DIR/samples.txt" 2> "$DIR/sampler.err"
      sample
    ) &
    echo $! > "$DIR/sampler.pid"
    ;;
  stop)
    PID=$(cat "$DIR/sampler.pid" 2> /dev/null || true)
    status=1
    if [ -n "$PID" ] && kill -0 "$PID" 2> /dev/null; then
      pkill -P "$PID" 2> /dev/null || true
      kill "$PID" 2> /dev/null || true
      # Alive is not enough: the last sample must be recent and no gap may exceed eight
      # intervals, room for slow `docker stats` (a hung source keeps the process alive
      # without new samples).
      last=$(awk '$2 == "host" {t = $1} END {print t + 0}' "$DIR/samples.txt")
      gap=$(awk '$2 == "host" {if (p && $1 - p > m) m = $1 - p; p = $1} END {print m + 0}' "$DIR/samples.txt")
      limit=$((INTERVAL * 8))
      [ "$last" -gt 0 ] && [ $(($(now) - last)) -le "$limit" ] && [ "$gap" -le "$limit" ] && status=0
    fi
    echo "$status" > "$DIR/sampler.exit"
    rm -f "$DIR/sampler.pid"
    [ "$status" -eq 0 ] || die "sampler did not run throughout the step"
    ;;
  *) die "usage: sampler.sh start|stop <dir>" ;;
esac
