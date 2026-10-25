#!/bin/sh
# Host-side facts for one load step (host, deployment checkout).
#   server-stats.sh logs                the raw test-entry access logs as a tar stream
#   server-stats.sh containers          "<name> <id> <restarts> <oom-killed>" per project container
#   server-stats.sh clock               host epoch milliseconds (the generator measures skew)
set -eu
. "$(dirname "$0")/lib.sh"
case "${1:-}" in
  logs)
    # The raw test-entry logs (current and rolled) as a tar stream. The statistics are
    # computed on the generator: a Node container here would take memory from the small
    # host being measured and evict the application's file cache (fresh-host diagnosis).
    lt_compose exec -T caddy sh -c 'cd /data && ls load-test-access* > /dev/null && tar cf - load-test-access*' ||
      die "no test-entry access log in caddy:/data"
    ;;
  containers)
    # The id reveals a container recreated under the same name during the step.
    ids=$(lt_compose ps -q)
    [ -n "$ids" ] || die "no running containers in this project"
    # shellcheck disable=SC2086 # one argument per container id
    docker inspect -f '{{.Name}} {{.Id}} {{.RestartCount}} {{.State.OOMKilled}}' $ids | sed 's#^/##'
    ;;
  clock) date +%s%3N ;; # milliseconds (GNU date)
  manifest) # key=value lines, no secrets
    echo "commit=$(git rev-parse HEAD 2> /dev/null || echo unknown)"
    echo "dirty=$(git status --porcelain 2> /dev/null | grep -qv '^??' && echo yes || echo no)"
    echo "arch=$(uname -m)"
    echo "cpus=$(nproc)"
    echo "cpu_model=$(sed -n 's/^model name[[:space:]]*: //p' /proc/cpuinfo | head -n 1)"
    echo "mem_total_mib=$(awk '/^MemTotal:/ {print int($2 / 1024)}' /proc/meminfo)"
    echo "swap=$(swapon --noheadings --show=NAME,SIZE 2> /dev/null | tr '\n' ' ' | sed 's/ *$//' | grep . || echo off)"
    echo "run_id=$(envval LOAD_TEST_RUN_ID)"
    # Same definition as the generator's harness_sha256: equal values mean both sides run
    # the same scripts, fixtures, k6 scenarios and avatar.
    echo "harness_sha256=$(cd "$LT_DIR" && find . -type f | LC_ALL=C sort | xargs sha256sum | sha256sum | cut -d' ' -f1)"
    echo "caddyfile_sha256=$(sha256sum docker/caddy/Caddyfile.load-test | cut -d' ' -f1)"
    for id in $(lt_compose ps -q); do
      docker inspect -f 'container={{.Name}} image={{.Config.Image}} digest={{.Image}} mem_limit={{.HostConfig.Memory}} nano_cpus={{.HostConfig.NanoCpus}}' "$id" | sed 's#=/#=#'
    done
    ;;
  *) die "usage: server-stats.sh logs | containers | clock | manifest" ;;
esac
