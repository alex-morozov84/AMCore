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
# Deliberately NOT under /var/lib/postgresql/data — that path is a VOLUME
# declared by this image, so a container started with `up` (rather than
# `run --rm`) leaves it as an orphaned anonymous volume that grows by one
# full database copy per drill run. /tmp is plain container filesystem, gone
# whenever the container is removed, no volume involved either way.
SCRATCH_PGDATA="/tmp/restore-drill-pgdata"
SCRATCH_DB="restore_drill"
SOCKET_DIR="/tmp"

cleanup() {
  su-exec postgres pg_ctl -D "$SCRATCH_PGDATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$SCRATCH_PGDATA"
}
trap cleanup EXIT

# Sort by filename, which is safe because backup.sh names dumps
# amcore-<UTC timestamp>.dump with a sortable ISO-8601-like format — the
# lexicographically last name is the most recent dump.
dump_file="$(find "$BACKUP_DIR" -maxdepth 1 -name 'amcore-*.dump' -type f | sort | tail -n 1)"
if [ -z "$dump_file" ]; then
  echo "[restore-drill] no amcore-*.dump found in ${BACKUP_DIR} — nothing to rehearse" >&2
  exit 1
fi
echo "[restore-drill] $(date -u -Iseconds) rehearsing restore of ${dump_file}"

rm -rf "$SCRATCH_PGDATA"
mkdir -p "$SCRATCH_PGDATA"
chown postgres:postgres "$SCRATCH_PGDATA"

# An overridden `entrypoint:` runs as root by default (verified against this
# image), and initdb/pg_ctl refuse to run as root — su-exec drops to the
# image's existing `postgres` OS user for the commands that need it.
#
# initdb always prints "no usable system locales were found" on this Alpine
# image regardless of the requested locale (musl ships no locale data at
# all) — harmless, but this is a PASS/FAIL tool whose output lands in cron
# mail, so capture it and only surface it if initdb actually fails.
if ! initdb_output="$(su-exec postgres initdb -D "$SCRATCH_PGDATA" --auth=trust --locale=C --encoding=UTF8 2>&1)"; then
  echo "[restore-drill] FAILED: initdb error:" >&2
  echo "$initdb_output" >&2
  exit 1
fi
su-exec postgres pg_ctl -D "$SCRATCH_PGDATA" \
  -o "-c listen_addresses='' -c unix_socket_directories=${SOCKET_DIR}" \
  -w start >/dev/null
su-exec postgres createdb -h "$SOCKET_DIR" "$SCRATCH_DB"

echo "[restore-drill] restoring..."
# --no-owner --no-privileges: the scratch cluster has none of the source
# database's roles (e.g. the migrator/runtime roles PR5 of this track adds),
# so restoring ownership or ACLs (GRANT/REVOKE) against them fails on every
# single one — a healthy dump would look broken. Skipping both is correct
# here specifically because this drill only proves the dump's *data and
# schema* restore cleanly, not that the target cluster already has the right
# roles provisioned (a separate, already-documented setup step).
if ! su-exec postgres pg_restore --no-owner --no-privileges -h "$SOCKET_DIR" -d "$SCRATCH_DB" "$dump_file"; then
  echo "[restore-drill] FAILED: pg_restore reported errors — see output above" >&2
  exit 1
fi

# Smoke check: the app's schema should have landed. This does not (and
# cannot, without knowing the current schema) assert row-level data
# correctness — it proves the dump is a well-formed, restorable Postgres
# archive that produces a non-empty schema, which is the failure mode
# GitLab's 2017 incident postmortem names as the one nobody had verified.
table_count="$(su-exec postgres psql -h "$SOCKET_DIR" -d "$SCRATCH_DB" -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'")"

if [ "${table_count:-0}" -lt 1 ] 2>/dev/null; then
  echo "[restore-drill] FAILED: restored database has no public tables (expected the app schema)" >&2
  exit 1
fi

echo "[restore-drill] $(date -u -Iseconds) PASSED — restored ${dump_file}, ${table_count} public tables present"
