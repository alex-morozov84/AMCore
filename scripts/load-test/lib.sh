# Shared helpers for scripts/load-test/*.sh (POSIX sh). Source it; do not run it.
# shellcheck disable=SC2034 # the image names and LT_DIR are used by the sourcing scripts
# Pinned images: k6 2.3.0 (the build used for the published capacity numbers), Caddy as
# in docker/compose/load-test.yml, Node as in apps/web/Dockerfile for the report tools.
K6_IMAGE=grafana/k6@sha256:e66db15b860113878fa74670e31f5e274830b7b6e42c8bff28b2f2d86a257603
CADDY_IMAGE=caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
NODE_IMAGE=node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
LT_DIR=$(cd "$(dirname "$0")" && pwd)

die() {
  echo "load-test: $*" >&2
  exit 1
}

# envval KEY [FILE]: the last KEY=value line of the deployment .env (quotes removed).
# The file is read, never sourced: values such as database URLs contain '&'.
envval() {
  sed -n "s/^$1=//p" "${2:-.env}" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# require_vars NAME...: each named shell variable must be non-empty.
require_vars() {
  for name in "$@"; do
    eval "value=\${$name:-}"
    [ -n "$value" ] || die "$name is required"
  done
}

ipv4() {
  echo "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
  for part in $(echo "$1" | tr '.' ' '); do [ "$part" -le 255 ] || return 1; done
}

run_id_ok() {
  echo "$1" | grep -Eq '^[a-z0-9]{4,32}$'
}

now() { date +%s; }
