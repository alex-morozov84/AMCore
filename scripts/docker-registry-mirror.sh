#!/usr/bin/env bash
# Route Docker Hub pulls through mirror.gcr.io for the whole Docker daemon, so one
# setting covers docker build, docker run, docker compose and Testcontainers. The
# daemon falls back to Docker Hub when the mirror cannot answer.
#
# The mirror is an optimization, so this script never fails the job. A failure is
# made visible instead: a warning annotation and a line in the run summary. A green
# job alone does not prove the mirror is active; look for "Registry mirrors:" below.
set -uo pipefail

configure() {
  set -e
  local config=/etc/docker/daemon.json
  sudo mkdir -p /etc/docker
  [ -s "$config" ] || echo '{}' | sudo tee "$config" > /dev/null
  sudo jq '. + {"registry-mirrors": ["https://mirror.gcr.io"]}' "$config" |
    sudo tee "$config.new" > /dev/null
  sudo mv "$config.new" "$config"
  sudo systemctl restart docker
  for _ in $(seq 1 30); do
    docker info > /dev/null 2>&1 && break
    sleep 1
  done
  local mirrors
  mirrors=$(docker info --format 'Registry mirrors: {{.RegistryConfig.Mirrors}}')
  echo "$mirrors" >&2
  [[ $mirrors == *mirror.gcr.io* ]]
}

if (configure); then
  status='Docker Hub mirror: active (mirror.gcr.io)'
else
  status='Docker Hub mirror: NOT configured, this job pulls from Docker Hub directly'
  echo "::warning title=Docker Hub mirror::${status}"
fi
echo "$status"
[ -z "${GITHUB_STEP_SUMMARY:-}" ] || echo "- ${status}" >> "$GITHUB_STEP_SUMMARY"
exit 0
