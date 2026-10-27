#!/bin/sh
# Guard the existing Compose-owned local_storage volume BEFORE Docker can mount it.
# Usage: sh scripts/recovery-files.sh backup|restore PROJECT VOLUME /private/backup-dir
set -eu
[ "$#" -eq 4 ] || { echo 'usage: recovery-files.sh backup|restore PROJECT VOLUME /absolute/backup-dir' >&2; exit 1; }
mode=$1 project=$2 volume=$3 directory=$4
case "$project" in [a-zA-Z0-9]*) ;; *) echo 'project is required' >&2; exit 1 ;; esac
case "$volume" in [a-zA-Z0-9]*) ;; *) echo 'volume is required' >&2; exit 1 ;; esac
case "$mode" in backup) readonly=,readonly ;; restore) readonly= ;; *) exit 1 ;; esac
case "$project:$volume" in *[!a-zA-Z0-9_.:-]*) echo 'invalid project/volume' >&2; exit 1 ;; esac
case "$directory" in /*) ;; *) echo 'backup directory must be absolute' >&2; exit 1 ;; esac
case "$directory" in *:*|*,*) echo 'unsupported backup directory' >&2; exit 1 ;; esac
[ -d "$directory" ] && [ ! -L "$directory" ] || { echo 'private backup directory missing' >&2; exit 1; }
owner=$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.project"}}')
logical=$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.volume"}}')
[ "$owner" = "$project" ] && [ "$logical" = local_storage ] || { echo 'volume ownership mismatch' >&2; exit 1; }
# All consumers must be stopped. Pausing a container is not stopping its writes.
consumers=$(docker ps -q --filter "volume=$volume")
[ -z "$consumers" ] || { echo 'volume has running consumers' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname "$0")/../docker/postgres" && pwd)
archive_readonly=
[ "$mode" != restore ] || archive_readonly=,readonly
docker run --rm --network none --tmpfs /var/lib/postgresql \
  --env "EXPORT_UID=$(id -u)" --env "EXPORT_GID=$(id -g)" \
  --mount "type=volume,src=$volume,dst=/data$readonly" \
  --mount "type=bind,src=$directory,dst=/archive$archive_readonly" \
  --mount "type=bind,src=$script_dir/local-files.sh,dst=/local-files.sh,readonly" \
  --entrypoint sh postgres:18-alpine /local-files.sh "$mode"
