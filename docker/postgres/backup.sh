#!/bin/sh
# AMCore — optional bundled backup profile (COMPOSE_PROFILES=...,backup). See
# docs/operations/backup-restore.md → "Using the compose backup/restore
# profiles". Loops forever, taking a pg_dump snapshot every
# BACKUP_INTERVAL_SECONDS and pruning dumps older than BACKUP_RETENTION_DAYS.
set -eu

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
BACKUP_DIR="/backups"

# Reject anything that isn't a positive integer before the loop starts —
# compose-only vars skip the app's Zod validation, and BACKUP_INTERVAL_SECONDS=0
# (or a non-numeric value that later breaks `sleep`/`find`) would otherwise
# turn `restart: unless-stopped` into a tight dump loop or a restart-churn crash.
is_positive_int() {
  case "$1" in
    '' | *[!0-9]*) return 1 ;;
    0) return 1 ;;
    *) return 0 ;;
  esac
}

if ! is_positive_int "$INTERVAL_SECONDS"; then
  echo "[backup] invalid BACKUP_INTERVAL_SECONDS='${INTERVAL_SECONDS}': must be a positive integer (seconds)" >&2
  exit 1
fi
if ! is_positive_int "$RETENTION_DAYS"; then
  echo "[backup] invalid BACKUP_RETENTION_DAYS='${RETENTION_DAYS}': must be a positive integer (days)" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

while true; do
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  dump_file="$BACKUP_DIR/amcore-${timestamp}.dump"

  echo "[backup] $(date -u -Iseconds) starting pg_dump -> ${dump_file}"
  # Custom format (-Fc): compressed, and the only format pg_restore can
  # selectively restore from. Dump to a .tmp path first and rename on success
  # so a crash mid-dump never leaves a truncated file that looks complete.
  if pg_dump --format=custom --file="${dump_file}.tmp" "$DATABASE_URL"; then
    mv "${dump_file}.tmp" "$dump_file"
    echo "[backup] $(date -u -Iseconds) completed ${dump_file}"
  else
    echo "[backup] $(date -u -Iseconds) pg_dump FAILED, discarding partial dump" >&2
    rm -f "${dump_file}.tmp"
  fi

  find "$BACKUP_DIR" -maxdepth 1 -name 'amcore-*.dump' -mtime "+${RETENTION_DAYS}" -delete

  sleep "$INTERVAL_SECONDS"
done
