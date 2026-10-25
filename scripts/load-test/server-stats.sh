#!/bin/sh
# Host-side facts for one load step (host, deployment checkout).
#   server-stats.sh window <from> <to>  request statistics of the test entry (JSON, stats.mjs)
#   server-stats.sh containers          "<name> <restarts> <oom-killed>" per project container
#   server-stats.sh clock               host epoch seconds (generator checks the clock skew)
set -eu
. "$(dirname "$0")/lib.sh"
case "${1:-}" in
  window)
    FROM=${2:?from} TO=${3:?to}
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    for f in $(docker compose exec -T caddy sh -c 'cd /data && ls load-test-access*' 2> /dev/null); do
      docker compose cp "caddy:/data/$f" "$TMP/$f" > /dev/null || die "cannot copy $f from caddy"
    done
    [ -n "$(ls "$TMP")" ] || die "no test-entry access log in caddy:/data"
    docker run --rm -v "$TMP:/logs:ro" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" node /lt/stats.mjs /logs "$FROM" "$TO"
    ;;
  containers)
    # shellcheck disable=SC2046 # one argument per container id
    docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.OOMKilled}}' $(docker compose ps -q) | sed 's#^/##'
    ;;
  clock) now ;;
  manifest) # key=value lines, no secrets
    echo "commit=$(git rev-parse HEAD 2> /dev/null || echo unknown)"
    echo "dirty=$(git status --porcelain 2> /dev/null | grep -qv '^??' && echo yes || echo no)"
    echo "arch=$(uname -m)"
    echo "cpus=$(nproc)"
    echo "cpu_model=$(sed -n 's/^model name[[:space:]]*: //p' /proc/cpuinfo | head -n 1)"
    echo "mem_total_mib=$(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
    echo "swap=$(swapon --noheadings --show=NAME,SIZE 2> /dev/null | tr '\n' ' ' | sed 's/ *$//' | grep . || echo off)"
    echo "protocol_sha256=$(cat "$LT_DIR"/fixture.ts "$LT_DIR"/k6/*.js "$LT_DIR"/protocol.sh | sha256sum | cut -d' ' -f1)"
    echo "caddyfile_sha256=$(sha256sum docker/caddy/Caddyfile.load-test | cut -d' ' -f1)"
    for id in $(docker compose ps -q); do
      docker inspect -f 'container={{.Name}} image={{.Config.Image}} digest={{.Image}} mem_limit={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}}' "$id" | sed 's#=/#=#'
    done
    ;;
  *) die "usage: server-stats.sh window <from> <to> | containers | clock | manifest" ;;
esac
