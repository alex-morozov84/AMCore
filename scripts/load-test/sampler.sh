#!/bin/sh
# Host sampler for one load step (host, deployment checkout).
#   sampler.sh start <dir>   samples every 5 s into <dir>/samples.txt
#   sampler.sh stop <dir>    stops it; writes <dir>/sampler.exit (0 only when it ran throughout)
# Lines: "<epoch> host avail=<MiB>", "<epoch> ctr <name> <mem> <cpu>", "<epoch> vmstat <row>".
set -eu
. "$(dirname "$0")/lib.sh"
CMD=${1:-}
DIR=${2:-}
[ -n "$DIR" ] || die "usage: sampler.sh start|stop <dir>"
INTERVAL=5

sample() {
  while :; do
    ts=$(now)
    avail=$(awk '/^MemAvailable:/ {print int($2 / 1024)}' /proc/meminfo)
    [ -n "$avail" ] || exit 1
    echo "$ts host avail=$avail"
    # shellcheck disable=SC2046 # one argument per container id
    docker stats --no-stream --format '{{.Name}} {{.MemUsage}} {{.CPUPerc}}' $(docker compose ps -q) |
      sed "s/^/$ts ctr /" || exit 1
    vmstat 1 2 | tail -n 1 | sed "s/^ */$ts vmstat /" || exit 1
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
      kill "$PID"
      # A gap longer than three intervals means the sampler stalled.
      gap=$(awk '$2 == "host" {if (p && $1 - p > m) m = $1 - p; p = $1} END {print m + 0}' "$DIR/samples.txt")
      [ "$gap" -le $((INTERVAL * 3 + 5)) ] && status=0
    fi
    echo "$status" > "$DIR/sampler.exit"
    rm -f "$DIR/sampler.pid"
    [ "$status" -eq 0 ] || die "sampler did not run throughout the step"
    ;;
  *) die "usage: sampler.sh start|stop <dir>" ;;
esac
