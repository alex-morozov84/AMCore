#!/bin/sh
# AMCore — optional bundled restore-drill profile (COMPOSE_PROFILES=...,restore-drill).
# See docs/operations/backup-restore.md → "Restore-drill (rehearsing a
# restore, not just taking one)". One-shot, invoked explicitly:
#   docker compose --profile restore-drill run --rm restore-drill
#
# Restores the most recent dump into a throwaway Postgres instance that lives
# only inside this container's own filesystem, then runs an integrity smoke
# check. Structurally cannot touch the real database: unlike `restore.sh`,
# this script never reads DATABASE_URL/COMPOSE_DATABASE_URL and never opens a
# network connection to the app's Postgres — the scratch instance is local,
# throwaway, and gone (`trap ... EXIT`) whether the drill passes or fails.
set -eu

BACKUP_DIR="/backups"
# Deliberately NOT under /var/lib/postgresql — that path is a VOLUME declared
# by this image, so a container started with `up` (rather than `run --rm`)
# leaves it as an orphaned anonymous volume that grows by one full database
# copy per drill run. /tmp is plain container filesystem, gone whenever the
# container is removed, no volume involved either way.
SCRATCH_PGDATA="/tmp/restore-drill-pgdata"
SCRATCH_DB="restore_drill"
SOCKET_DIR="/tmp"

cleanup() {
  gosu postgres pg_ctl -D "$SCRATCH_PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$SCRATCH_PGDATA"
}
trap cleanup EXIT

# Explicit selection never falls back to another archive.
[ "$#" -le 2 ] || { echo 'usage: restore-drill [dump-basename [assertions.sql]]' >&2; exit 1; }
if [ "$#" -ge 1 ]; then
  case "$1" in '' | . | .. | */*) echo 'invalid dump basename' >&2; exit 1 ;; esac
  dump_file="$BACKUP_DIR/$1"
else
  dump_file="$(find "$BACKUP_DIR" -maxdepth 1 -name 'amcore-*.dump' -type f | sort | tail -n 1)"
fi
[ -n "$dump_file" ] && [ -f "$dump_file" ] || { echo 'dump not found' >&2; exit 1; }
baseline=/scripts/restore-baseline.sql
[ -s "$baseline" ] || { echo 'baseline SQL missing or empty' >&2; exit 1; }
if [ "$#" -eq 2 ]; then
  [ -f "$2" ] && [ -s "$2" ] && [ -r "$2" ] || { echo 'assertions SQL missing, empty or unreadable' >&2; exit 1; }
fi
echo "[restore-drill] $(date -u -Iseconds) rehearsing restore of ${dump_file}"

rm -rf "$SCRATCH_PGDATA"
mkdir -p "$SCRATCH_PGDATA"
chown postgres:postgres "$SCRATCH_PGDATA"

# An overridden `entrypoint:` runs as root by default (verified against this
# image), and initdb/pg_ctl refuse to run as root — gosu drops to the
# image's existing `postgres` OS user for the commands that need it.
#
# initdb always prints "no usable system locales were found" on this Alpine
# image regardless of the requested locale (musl ships no locale data at
# all) — harmless, but this is a PASS/FAIL tool whose output lands in cron
# mail, so capture it and only surface it if initdb actually fails.
if ! initdb_output="$(gosu postgres initdb -D "$SCRATCH_PGDATA" --auth=trust --locale=C --encoding=UTF8 2>&1)"; then
  echo "[restore-drill] FAILED: initdb error:" >&2
  echo "$initdb_output" >&2
  exit 1
fi
gosu postgres pg_ctl -D "$SCRATCH_PGDATA" \
  -o "-c listen_addresses='' -c unix_socket_directories=${SOCKET_DIR}" \
  -w start >/dev/null
gosu postgres createdb -h "$SOCKET_DIR" "$SCRATCH_DB"

echo "[restore-drill] restoring..."
# --no-owner --no-privileges: the scratch cluster has none of the source
# database's roles (e.g. the migrator/runtime roles PR5 of this track adds),
# so restoring ownership or ACLs (GRANT/REVOKE) against them fails on every
# single one — a healthy dump would look broken. Skipping both is correct
# here specifically because this drill only proves the dump's *data and
# schema* restore cleanly, not that the target cluster already has the right
# roles provisioned (a separate, already-documented setup step).
if ! gosu postgres pg_restore --exit-on-error --no-owner --no-privileges -h "$SOCKET_DIR" -d "$SCRATCH_DB" < "$dump_file"; then
  echo "[restore-drill] FAILED: pg_restore reported errors — see output above" >&2
  exit 1
fi

# Read-only SQL is trusted operator code, not a hostile-input sandbox.
verify_sql() {
  gosu postgres psql -X -v ON_ERROR_STOP=1 -h "$SOCKET_DIR" -d "$SCRATCH_DB" \
    -c 'BEGIN READ ONLY' -f - -c 'COMMIT' < "$1" >/dev/null
}
verify_sql "$baseline"
echo '[restore-drill] PASSED structural verification (owners/ACLs not checked)'
if [ "$#" -eq 2 ]; then
  verify_sql "$2"
  echo '[restore-drill] PASSED selected-data assertions'
else
  echo '[restore-drill] selected-data assertions NOT REQUESTED'
fi
