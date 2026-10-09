#!/usr/bin/env bash
set -euo pipefail

source_root=$(cd "$(dirname "$0")/../.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/notification-ai-extension.XXXXXX")
finished=false
cleanup() {
  if [[ "$finished" == true ]]; then
    rm -rf -- "$fixture_root"
  else
    echo "Fixture preserved for diagnosis: $fixture_root" >&2
  fi
}
trap cleanup EXIT

rsync -a \
  --exclude='/.git/' --exclude='/ai/' --exclude='/.amcore/' \
  --exclude='/.worktrees/' --exclude='node_modules/' --exclude='dist/' \
  --exclude='.next/' --exclude='.env*' \
  --exclude='/apps/api/src/generated/prisma/' \
  "$source_root/" "$fixture_root/"
ln -s "$source_root/node_modules" "$fixture_root/node_modules"
for package in apps/api apps/web packages/shared; do
  mkdir -p "$fixture_root/$package/node_modules"
  rsync -a "$source_root/$package/node_modules/" "$fixture_root/$package/node_modules/"
done

(cd "$fixture_root/packages/shared" && ./node_modules/.bin/tsup)
(cd "$fixture_root/apps/api" && ./node_modules/.bin/prisma generate)
(cd "$fixture_root/apps/api" && ./node_modules/.bin/tsc --noEmit)
(cd "$fixture_root/apps/api" && \
  NODE_OPTIONS=--experimental-vm-modules \
  ./node_modules/.bin/jest --config jest-e2e.config.js --runInBand \
  --runTestsByPath \
  test/extension-registration.e2e-spec.ts \
  test/notification-extension-contracts.e2e-spec.ts \
  test/notification-prepared-request.e2e-spec.ts \
  test/ai-tool-extension-contracts.e2e-spec.ts \
  test/ai-run-legacy-and-locks.e2e-spec.ts \
  test/ai-provider-extension-contracts.e2e-spec.ts \
  test/notification-ai-legacy-migration.e2e-spec.ts \
  test/openapi.e2e-spec.ts)
finished=true
