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
      jq -r --arg name "$name" '[.[] | select(.source_type == "Repository" and .name == $name)][0].id // empty'
  )

  if [[ -n $existing_id ]]; then
    echo "setup-repo-security: updating ruleset '$name' ($existing_id)"
    api --method PUT "repos/$owner/$repo/rulesets/$existing_id" --input "$file" >/dev/null
    return
  fi

  echo "setup-repo-security: creating ruleset '$name'"
  api --method POST "repos/$owner/$repo/rulesets" --input "$file" >/dev/null
}

# Delete every repository-owned ruleset with this name. Idempotent: tolerates
# absence (and duplicates) so the script stays safe to re-run — e.g. the retired
# `Protect develop` ruleset after the trunk-based migration (ADR-048).
delete_ruleset_by_name() {
  local owner=$1
  local repo=$2
  local name=$3
  local ids id

  ids=$(
    api "repos/$owner/$repo/rulesets" |
      jq -r --arg name "$name" '.[] | select(.source_type == "Repository" and .name == $name) | .id'
  )

  if [[ -z $ids ]]; then
    echo "setup-repo-security: ruleset '$name' already absent"
    return
  fi

  while IFS= read -r id; do
    [[ -z $id ]] && continue
    echo "setup-repo-security: deleting obsolete ruleset '$name' ($id)"
    api --method DELETE "repos/$owner/$repo/rulesets/$id" >/dev/null
  done <<<"$ids"
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
  "allow_squash_merge": true,
  "allow_merge_commit": false,
  "allow_rebase_merge": false,
  "delete_branch_on_merge": true,
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

# Dependabot security updates: auto-open PRs that fix a vulnerable dependency.
# Distinct from the alerts above AND from the version updates in dependabot.yml
# (which ignores semver-majors) — this is the only channel that will auto-propose
# a fix for a vulnerability whose patched release is a major bump. Requires the
# alerts enabled above. Forks do NOT inherit this setting, so strict setup applies
# it. Tolerated (not fatal): some plans/visibilities reject the call, and the rest
# of the security setup must still complete. See
# https://docs.github.com/en/rest/repos/repos#enable-dependabot-security-updates
if api --method PUT "repos/$owner/$repo/automated-security-fixes" >/dev/null 2>&1; then
  echo "setup-repo-security: enabled Dependabot security updates (automated-security-fixes)"
else
  echo "setup-repo-security: WARNING could not enable Dependabot security updates; enable manually in Settings -> Code security (Dependabot security updates)" >&2
fi

echo "setup-repo-security: ensured squash-only merges + delete-branch-on-merge, dependency graph, vulnerability alerts, secret scanning, and push protection"

upsert_ruleset "$owner" "$repo" "$RULESET_DIR/main.json"
upsert_ruleset "$owner" "$repo" "$RULESET_DIR/tags-release.json"

# Trunk-based migration (ADR-048): the long-lived `develop` branch is retired in
# favour of GitHub Flow on `main`. Remove its obsolete live ruleset by name — its
# deletion-restriction would otherwise block deleting the branch. Idempotent.
delete_ruleset_by_name "$owner" "$repo" "Protect develop"

echo "setup-repo-security: repository security settings are up to date"
