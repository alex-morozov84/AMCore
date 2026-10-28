#!/bin/sh
# Runs only inside the named-volume helper. Trusted archives, bounded regular trees.
set -eu
umask 077
export LC_ALL=C
mode=${1:?backup or restore}
archive=/archive/local-files.tar
refuse() { echo "local-files: $*" >&2; exit 1; }

check_tree() {
  find /data -mindepth 1 -exec sh -c '
    for entry do
      relative=${entry#/data/}
      case "$relative" in *[!a-zA-Z0-9_./-]*) exit 1 ;; esac
      case "$relative" in objects|objects/*|meta|meta/*|public|public/*) ;; *) exit 1 ;; esac
      [ ! -L "$entry" ] && { [ -d "$entry" ] || [ -f "$entry" ]; } || exit 1
      if [ -f "$entry" ]; then [ "$(stat -c %h "$entry")" = 1 ] || exit 1; fi
    done
  ' sh {} + || refuse 'unsupported source path/type (regular files/directories only)'
}

check_archive() {
  tar -tf "$archive" > /tmp/members
  tar -tvf "$archive" > /tmp/types
  [ -s /tmp/members ] || refuse 'empty archive listing'
  while IFS= read -r member; do
    case "$member" in *[!a-zA-Z0-9_./-]*) refuse 'unsupported archive name' ;; esac
    case "/$member/" in */../*|*/./../*) refuse 'parent path in archive' ;; esac
    case "$member" in ./|./objects|./objects/*|./meta|./meta/*|./public|./public/*) ;;
      *) refuse 'unexpected archive root' ;; esac
  done < /tmp/members
  # This helper uses the postgres:18-alpine BusyBox tar verbose type column.
  while IFS= read -r entry; do
    case "$entry" in -*|d*) ;; *) refuse 'archive contains a link/device/unsupported type' ;; esac
  done < /tmp/types
}

case "$mode" in
  backup)
    [ ! -e "$archive" ] && [ ! -L "$archive" ] && [ ! -e "$archive.sha256" ] && [ ! -L "$archive.sha256" ] && [ ! -e "$archive.tmp" ] && [ ! -L "$archive.tmp" ] || refuse 'use a new backup directory'
    check_tree
    trap 'rm -f /archive/local-files.tar.tmp' EXIT
    tar -cf /archive/local-files.tar.tmp --exclude=./objects/.amcore-probes \
      --exclude=./meta/.amcore-probes -C /data .
    mv /archive/local-files.tar.tmp "$archive"
    (cd /archive && sha256sum local-files.tar > local-files.tar.sha256)
    chown "${EXPORT_UID:-0}:${EXPORT_GID:-0}" "$archive" "$archive.sha256"
    ;;
  restore)
    entries=$(find /data -mindepth 1 -print -quit)
    [ -z "$entries" ] || refuse 'target is not empty'
    [ -f "$archive" ] && [ -f "$archive.sha256" ] || refuse 'archive/checksum missing'
    # Do not let an edited checksum file select another path.
    expected=$(cat "$archive.sha256")
    actual=$(cd /archive && sha256sum local-files.tar)
    [ "$expected" = "$actual" ] || refuse 'archive checksum mismatch'
    check_archive
    tar -xf "$archive" -C /data
    chown -R 1001:1001 /data
    find /data -type d -exec chmod 0750 {} +
    find /data -type f -exec chmod 0640 {} +
    check_tree
    ;;
  *) refuse 'expected backup or restore' ;;
esac
echo "local-files: $mode completed"
