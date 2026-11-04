#!/usr/bin/env bash
# Route Docker Hub pulls through mirror.gcr.io for the whole Docker daemon, so one
# setting covers docker build, docker run, docker compose and Testcontainers. The
# daemon falls back to Docker Hub when the mirror cannot answer. CI runs this step
# with continue-on-error: the mirror is an optimization, not a requirement.
set -euo pipefail

config=/etc/docker/daemon.json
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
docker info --format 'Registry mirrors: {{.RegistryConfig.Mirrors}}'
