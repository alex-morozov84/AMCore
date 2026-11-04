#!/usr/bin/env bash
# Free about 17 GiB on a hosted Linux runner by removing the Android and .NET SDKs, which
# no AMCore job uses. Hosted runners guarantee only about 14 GB of free disk, and some
# machines have less than others. The API readiness check fails above 90% disk use, so a
# job that builds images on a nearly full runner shows up as an unhealthy `api` container.
# The df lines before and after show how much space the job really had.
set -euo pipefail

report() {
  df -B1 / "$GITHUB_WORKSPACE" "$RUNNER_TEMP"
  df -i / "$GITHUB_WORKSPACE" "$RUNNER_TEMP"
}

report
sudo rm -rf -- /usr/local/lib/android /usr/share/dotnet
report
