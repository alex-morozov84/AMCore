#!/bin/sh
# Load-test fixtures for this run's own database (host, deployment checkout).
#   fixture.sh build   build the one-shot loader image (reuses the API build stage)
#   fixture.sh         verify on the host that the Postgres volume carries this run's label,
#                      then run the loader. The loader itself refuses foreign, partial or
#                      non-fresh databases.
set -eu
. "$(dirname "$0")/lib.sh"
RUN=$(envval LOAD_TEST_RUN_ID)
PROJECT=$(envval COMPOSE_PROJECT_NAME)
run_id_ok "$RUN" || die "LOAD_TEST_RUN_ID is not set or invalid"
[ "$PROJECT" = "amcore-loadtest-$RUN" ] || die "COMPOSE_PROJECT_NAME must be amcore-loadtest-$RUN"
# A --profile flag would replace COMPOSE_PROFILES from .env (and drop the bundled database),
# so the loader's profile is added to the configured ones instead.
COMPOSE_PROFILES="$(envval COMPOSE_PROFILES),load-test"
export COMPOSE_PROFILES
if [ "${1:-}" = build ]; then
  docker compose build load-fixture
  exit
fi
VOLUME="${PROJECT}_postgres_data_pg18"
LABEL=$(docker volume inspect "$VOLUME" --format '{{index .Labels "org.amcore.load-test"}}' 2> /dev/null) ||
  die "volume $VOLUME not found; bring the run's project up first"
[ "$LABEL" = "$RUN" ] || die "volume $VOLUME is not labelled for run $RUN (found '$LABEL'); refusing to write"
docker compose run --rm --no-deps -e LOAD_TEST_OWNERSHIP_CHECKED="$RUN" load-fixture
