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

# lt_compose [KEY=value ...] <compose args>: docker compose for the deployment .env only.
# Shell variables override .env during interpolation, so the environment is cleared: every
# script acts on the project, files and database URLs that .env names, never on inherited
# ones. Leading KEY=value words (no spaces) are the only additions.
lt_compose() {
  extra=
  while [ $# -gt 0 ]; do
    case "$1" in
      [A-Z]*=*)
        extra="$extra $1"
        shift
        ;;
      *) break ;;
    esac
  done
  # shellcheck disable=SC2086 # extra is a list of KEY=value words
  env -i PATH="$PATH" HOME="$HOME" ${DOCKER_HOST:+DOCKER_HOST="$DOCKER_HOST"} \
    ${DOCKER_CONTEXT:+DOCKER_CONTEXT="$DOCKER_CONTEXT"} $extra \
    docker compose --project-directory "$PWD" -p "$(envval COMPOSE_PROJECT_NAME)" "$@"
}

# Tell the operator which inherited variables lt_compose ignores.
warn_overrides() {
  names=$(env | grep -E '^(COMPOSE_[A-Z_]*|LOAD_TEST_[A-Z_]*|[A-Z_]*DATABASE_URL|POSTGRES_[A-Z_]*)=' | cut -d= -f1 | tr '\n' ' ')
  [ -z "$names" ] || echo "load-test: ignoring environment variables (the deployment .env decides): $names" >&2
}

# check_target <project> <run> [running]: the effective configuration (and, with
# "running", the running postgres, api, worker and web containers) belongs to this run's
# own deployment.
# The rendered configuration holds secrets; it stays in a private temporary directory.
check_target() {
  target_dir=$(mktemp -d)
  chmod 700 "$target_dir"
  target_status=0
  lt_compose COMPOSE_PROFILES="$(envval COMPOSE_PROFILES),load-test" config --format json > "$target_dir/config.json" ||
    target_status=2
  set -- /d/config.json "$1" "$2" "${3:-}"
  if [ "$target_status" -eq 0 ] && [ "$4" = running ]; then
    # The running containers, not only the rendered files: a container created from an
    # older .env keeps its old database URL until it is recreated.
    running=$(lt_compose ps -q postgres api worker web)
    if [ -n "$running" ]; then
      # shellcheck disable=SC2086 # one argument per container id
      docker inspect $running > "$target_dir/running.json" || target_status=2
    else
      target_status=1
    fi
    set -- "$1" "$2" "$3" /d/running.json
  else
    set -- "$1" "$2" "$3"
  fi
  if [ "$target_status" -eq 0 ]; then
    # Exit 1 is a found violation; any other failure (for example 125: the image could not
    # be pulled) means the check did not run, which is not a statement about the target.
    docker run --rm -v "$target_dir:/d:ro" -v "$LT_DIR:/lt:ro" "$NODE_IMAGE" node /lt/target-check.mjs "$@" ||
      target_status=$?
  fi
  rm -rf "$target_dir"
  case "$target_status" in
    0) ;;
    1) die "the effective deployment is not this run's own project (see above)" ;;
    *) die "the target check could not run (exit $target_status, see above); nothing was written" ;;
  esac
}
