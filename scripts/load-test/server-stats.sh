#!/bin/sh
# Host-side facts for one load step (host, deployment checkout).
#   server-stats.sh logs                the raw test-entry access logs as a tar stream
#   server-stats.sh containers          "<name> <id> <restarts> <oom-killed>" per project container
set -eu
. "$(dirname "$0")/lib.sh"
case "${1:-}" in
  logs)
    # The raw test-entry logs (current and rolled) as a tar stream. The statistics are
    # computed on the generator, so the harness starts no Node container on the small host
    # being measured: less harness memory and CPU there, whatever caused the start-of-step
    # stalls seen on one fresh host (low available memory was a plausible factor).
    lt_compose exec -T caddy sh -c 'cd /data && ls load-test-access* > /dev/null && tar cf - load-test-access*' ||
      die "no test-entry access log in caddy:/data"
    ;;
  containers)
    services=$(lt_compose config --services) || die "cannot read configured services"
    ids=$(lt_compose ps -q --no-trunc) || die "cannot list running containers"
    [ -n "$ids" ] || die "no running containers in this project"
    # Keep the inspect status and validate the whole snapshot before publishing it.
    # shellcheck disable=SC2086 # one argument per container id
    snapshot=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}} {{.Name}} {{.Id}} {{.RestartCount}} {{.State.OOMKilled}}' $ids) ||
      die "cannot inspect running containers"
    # This topology has one replica per long-running service. One-shot tasks
    # do not belong in a measurement, even if their profiles are enabled.
    rows=$(printf '%s\n' "$snapshot" | INVENTORY_SERVICES="$services" INVENTORY_IDS="$ids" awk '
      BEGIN {
        n = split(ENVIRON["INVENTORY_SERVICES"], names, "\n")
        for (i = 1; i <= n; i++)
          if (names[i] != "" && names[i] !~ /^(migrate|system-seed|restore|restore-drill|load-fixture)$/)
            expected[names[i]] = 1
        n = split(ENVIRON["INVENTORY_IDS"], listed, "\n")
        for (i = 1; i <= n; i++) wanted[listed[i]] = 1
      }
      NF != 5 || !($1 in expected) || seenService[$1]++ ||
        $2 !~ /^\// || seenName[$2]++ || !($3 in wanted) || seenId[$3]++ ||
        $4 !~ /^[0-9]+$/ || $5 !~ /^(true|false)$/ { bad = 1; next }
      { print substr($2, 2), $3, $4, $5 }
      END {
        for (service in expected) if (!seenService[service]) bad = 1
        for (id in wanted) if (!seenId[id]) bad = 1
        if (bad) exit 1
      }
    ') || die "container inventory does not match the configured project"
    printf '%s\n' "$rows"
    ;;
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
  *) die "usage: server-stats.sh logs | containers | manifest" ;;
esac
