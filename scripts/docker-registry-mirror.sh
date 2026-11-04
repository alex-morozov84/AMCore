#!/usr/bin/env bash
# Pull Docker Hub images through mirror.gcr.io for the whole Docker daemon (build, run,
# compose, Testcontainers). The daemon falls back to Docker Hub if the mirror is down.
# The mirror is an optimization: on any failure restore the original config and carry on
# with a warning. Fail only if Docker itself does not come back. A green job does not
# prove the mirror is active; look for "Docker Hub mirror: active" in the run summary.
# No `set -e`: a function called from an `if` ignores it, so each step is checked.
set -uo pipefail

config=${DOCKER_DAEMON_CONFIG:-/etc/docker/daemon.json}
attempts=${DOCKER_READY_ATTEMPTS:-20}

ready() {
  for ((i = 0; i < attempts; i++)); do
    timeout 5 docker info > /dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}
restart() { timeout 60 sudo systemctl restart docker && ready; }

empty='{}'
original=$(sudo cat "$config" 2> /dev/null) && had_config=1 || had_config=0
next=$(jq -c '. + {"registry-mirrors": ["https://mirror.gcr.io"]}' <<< "${original:-$empty}") || next=''

rollback() {
  if [ "$had_config" = 1 ]; then printf '%s\n' "$original" | sudo tee "$config" > /dev/null; else sudo rm -f "$config"; fi
  restart || exit_code=2
}

exit_code=0
if [ -n "$next" ] && printf '%s\n' "$next" | sudo tee "$config" > /dev/null && restart &&
  docker info --format '{{.RegistryConfig.Mirrors}}' | grep -q mirror.gcr.io; then
  status='Docker Hub mirror: active (mirror.gcr.io)'
else
  [ -z "$next" ] || rollback
  status='Docker Hub mirror: NOT configured, pulls go to Docker Hub directly'
  echo "::warning title=Docker Hub mirror::${status}"
  [ "$exit_code" = 0 ] || { echo "::error title=Docker Hub mirror::Docker did not recover"; status='Docker Hub mirror: Docker did not recover'; }
fi
echo "$status"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "- ${status}" >> "$GITHUB_STEP_SUMMARY"
[ "$exit_code" = 0 ] || exit 1
