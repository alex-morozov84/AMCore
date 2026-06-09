#!/usr/bin/env bash
set -euo pipefail

API_VERSION=2022-11-28
ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RULESET_DIR="$ROOT_DIR/.github/rulesets"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "setup-repo-security: missing required command: $1" >&2
    exit 1
  fi
}

api() {
  gh api \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: $API_VERSION" \
    "$@"
}

upsert_ruleset() {
  local owner=$1
  local repo=$2
  local file=$3
  local name existing_id

  name=$(jq -r '.name' "$file")
  existing_id=$(
    api "repos/$owner/$repo/rulesets" |
      jq -r --arg name "$name" '.[] | select(.source_type == "Repository" and .name == $name) | .id' |
      head -n 1
  )

  if [[ -n $existing_id ]]; then
    echo "setup-repo-security: updating ruleset '$name' ($existing_id)"
    api --method PUT "repos/$owner/$repo/rulesets/$existing_id" --input "$file" >/dev/null
    return
  fi

  echo "setup-repo-security: creating ruleset '$name'"
  api --method POST "repos/$owner/$repo/rulesets" --input "$file" >/dev/null
}

need_cmd gh
need_cmd jq

if ! gh auth status >/dev/null 2>&1; then
  echo "setup-repo-security: gh auth status failed; log in with repository admin access first" >&2
  exit 1
fi

repo_json=$(gh repo view --json nameWithOwner)
repo_full_name=$(printf '%s' "$repo_json" | jq -r '.nameWithOwner')
owner=${repo_full_name%/*}
repo=${repo_full_name#*/}

echo "setup-repo-security: applying security settings to $repo_full_name"

api --method PATCH "repos/$owner/$repo" --input - >/dev/null <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": {
      "status": "enabled"
    },
    "secret_scanning_push_protection": {
      "status": "enabled"
    }
  }
}
JSON

api --method PUT "repos/$owner/$repo/vulnerability-alerts" >/dev/null

echo "setup-repo-security: ensured dependency graph, vulnerability alerts, secret scanning, and push protection"

upsert_ruleset "$owner" "$repo" "$RULESET_DIR/main.json"
upsert_ruleset "$owner" "$repo" "$RULESET_DIR/develop.json"

echo "setup-repo-security: repository security settings are up to date"
