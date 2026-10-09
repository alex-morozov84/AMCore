#!/usr/bin/env bash
set -euo pipefail

source_root=$(cd "$(dirname "$0")/../.." && pwd)
fixture_root=$(mktemp -d "${TMPDIR:-/tmp}/t024-extension.XXXXXX")
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

git -C "$fixture_root" apply --check \
  "$source_root/scripts/fixtures/t024-capability-extension.patch"
git -C "$fixture_root" apply \
  "$source_root/scripts/fixtures/t024-capability-extension.patch"
chmod +x "$fixture_root/fixture-bin/pnpm"

(cd "$fixture_root/packages/shared" && ./node_modules/.bin/tsup)
(cd "$fixture_root/apps/api" && ./node_modules/.bin/prisma generate)
(cd "$fixture_root/apps/api" && ./node_modules/.bin/tsc --noEmit)
(cd "$fixture_root/apps/web" && ./node_modules/.bin/tsc --noEmit)
(cd "$fixture_root/apps/api" && \
  ./node_modules/.bin/jest --config jest.config.js --runInBand \
  --runTestsByPath src/core/organizations/capability-policy-parity.spec.ts --silent)
(cd "$fixture_root/apps/api" && \
  PATH="$fixture_root/fixture-bin:$PATH" NODE_OPTIONS=--experimental-vm-modules \
  ./node_modules/.bin/jest --config jest-e2e.config.js --runInBand \
  --runTestsByPath test/fixture-order-extension.e2e-spec.ts --silent)
cat "$fixture_root/apps/api/fixture-order-measurement.json"

# The access journey: register -> configure a role -> assign -> explain, compared with the real
# handlers. Run by name, with a floor on the reported counts so a skipped suite cannot pass silently.
expect_passed() {
  node -e '
    const [file, minimum, label] = process.argv.slice(1)
    const result = JSON.parse(require("node:fs").readFileSync(file, "utf8"))
    const passed = result.numPassedTests ?? result.numPassed ?? 0
    const failed = result.numFailedTests ?? result.numFailed ?? 0
    if (failed !== 0 || passed < Number(minimum)) {
      console.error(label + ": passed " + passed + " (need >= " + minimum + "), failed " + failed)
      process.exit(1)
    }
    console.log(label + ": " + passed + " passed")
  ' "$@"
}
(cd "$fixture_root/apps/api" && \
  PATH="$fixture_root/fixture-bin:$PATH" NODE_OPTIONS=--experimental-vm-modules \
  ./node_modules/.bin/jest --config jest-e2e.config.js --runInBand \
  --runTestsByPath test/fixture-order-access.e2e-spec.ts --silent \
  --json --outputFile="$fixture_root/access-journey.json")
expect_passed "$fixture_root/access-journey.json" 13 "access journey (API e2e)"
# Every catalogue entry must have copy in every web catalogue, so both screens can show it.
(cd "$fixture_root/apps/web" && \
  ./node_modules/.bin/vitest run --project=unit \
  src/entities/organization-context/model/catalogue-copy.test.ts \
  --reporter=json --outputFile="$fixture_root/catalogue-copy.json")
expect_passed "$fixture_root/catalogue-copy.json" 1 "catalogue copy (web unit)"
finished=true
