#!/bin/sh
# AMCore — optional bundled restore profile (COMPOSE_PROFILES=...,restore). See
# docs/operations/backup-restore.md → "Restore". One-shot, invoked explicitly:
#   docker compose --profile restore run --rm restore <dump-filename>
# Destructive for every object present in the dump (dropped and recreated) —
# NOT a full database wipe: target objects absent from the dump are untouched.
set -eu

BACKUP_DIR="/backups"

if [ "$#" -ne 1 ]; then
  echo "usage: restore <dump-filename>" >&2
  echo "available dumps in ${BACKUP_DIR}:" >&2
  ls -1 "$BACKUP_DIR" >&2 2>/dev/null || true
  exit 1
fi

dump_file="${BACKUP_DIR}/$1"
if [ ! -f "$dump_file" ]; then
  echo "error: ${dump_file} not found" >&2
  exit 1
fi

echo "[restore] restoring ${dump_file} into the database at DATABASE_URL"
# --clean --if-exists: drop and recreate each object the dump contains (see
# the header comment — this does not remove target objects the dump doesn't
# know about; restore into an empty/scratch database first if you need a
# clean replacement). --no-owner: the dump may have been taken under a
# different role than the target's, so don't try to reassign ownership to
# roles that might not exist there.
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" "$dump_file"
echo "[restore] done"
