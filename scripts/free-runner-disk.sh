#!/usr/bin/env bash
# Reclaim unused SDK space unless an explicitly selected lane passes conservative
# capacity, storage and effective-readiness admission. No option keeps legacy cleanup.
set -euo pipefail

report() {
  df -B1 / "$GITHUB_WORKSPACE" "$RUNNER_TEMP"
  df -i / "$GITHUB_WORKSPACE" "$RUNNER_TEMP"
}

report
if [[ "${1:-}" == "--lane" && "$#" == 2 ]]; then
  if node "$(dirname "$0")/runner-disk-admission.mjs" "$2"; then
    report
    exit 0
  fi
fi
sudo rm -rf -- /usr/local/lib/android /usr/share/dotnet
report
