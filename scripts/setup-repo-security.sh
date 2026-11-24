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

plan_ruleset() {
  local owner=$1
  local repo=$2
  local file=$3
  local name existing_id live

  name=$(jq -r '.name' "$file")
  existing_id=$(
    printf '%s\n' "$live_rulesets" |
      jq -r --arg name "$name" '[.[] | select(.source_type == "Repository" and .name == $name)] | if length > 1 then error("Duplicate rulesets") else .[0].id // empty end'
  )

  if [[ -n $existing_id ]]; then
    live=$(api "repos/$owner/$repo/rulesets/$existing_id")
    jq -e --arg id "$existing_id" --slurpfile template "$file" '
      def editable: { name, target, enforcement, conditions, bypass_actors, rules };
      editable as $current | $template[0] as $policy |
      if ($current.rules | type) != "array" then error("Invalid live ruleset")
      elif $current.enforcement != "active" or $current.target != $policy.target or
        $current.conditions != $policy.conditions
      then error("Resolve the inactive or differently scoped ruleset before setup: " + $policy.name)
      else
        $current | .rules |= (
          map(select(.type != "required_linear_history" or $policy.target != "branch" or any($policy.rules[]; .type == "required_linear_history"))) |
          map(
            if .type == "pull_request" and any($policy.rules[]; .type == "pull_request") then
              .parameters.allowed_merge_methods = ($policy.rules[] | select(.type == "pull_request").parameters.allowed_merge_methods)
            elif .type == "required_status_checks" and any($policy.rules[]; .type == "required_status_checks") then
              .parameters.strict_required_status_checks_policy = true |
              .parameters.required_status_checks |= (
                . as $live |
                ($policy.rules[] | select(.type == "required_status_checks").parameters.required_status_checks) as $required |
                if any($required[]; . as $check |
                    $check.integration_id != null and any($live[];
                      .context == $check.context and .integration_id != null and .integration_id != $check.integration_id))
                then error("Conflicting check publisher in " + $policy.name)
                else
                  ($required | map(. as $check |
                    ($live | map(select(.context == $check.context)) | first // {}) + $check)) +
                  ($live | map(. as $check | select(all($required[]; .context != $check.context))))
                end
              )
            else . end
          ) as $rules |
          $rules + [$policy.rules[] | . as $rule | select(all($rules[]; .type != $rule.type))]
        )
      end | {id: $id, body: .}' <<<"$live"
    return
  fi
  jq '{id: "", body: .}' "$file"
}

apply_ruleset() {
  local plan=$1
  local id
  id=$(jq -r .id <<<"$plan")
  if [[ -n $id ]]; then
    jq .body <<<"$plan" | api --method PUT "repos/$owner/$repo/rulesets/$id" --input - >/dev/null
  else
    jq .body <<<"$plan" | api --method POST "repos/$owner/$repo/rulesets" --input - >/dev/null
  fi
}

fork_updates=false
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 1 || $1 != --fork-updates ]]; then
    echo "usage: bash scripts/setup-repo-security.sh [--fork-updates]" >&2
    exit 1
  fi
  fork_updates=true
fi

context_mode=$(awk '
  /^[[:space:]]*[-*][[:space:]]+\*\*Mode:/ {
    count++
    if ($0 == "- **Mode:** `downstream-product`") mode="downstream-product"
    if ($0 == "- **Mode:** `upstream-starter`") mode="upstream-starter"
  }
  END { if (count == 1) print mode }
' "$ROOT_DIR/PROJECT_CONTEXT.md" 2>/dev/null || true)
if [[ -z $context_mode ]]; then
  echo "setup-repo-security: missing or ambiguous repository mode" >&2
  exit 1
fi
if [[ $fork_updates == true && $context_mode != downstream-product ]]; then
  echo "setup-repo-security: --fork-updates requires one canonical downstream-product Mode in PROJECT_CONTEXT.md" >&2
  exit 1
fi
if [[ $context_mode == downstream-product ]]; then
  workflow_mode=$(awk -F '`' '/^- [*][*]Workflow mode:[*][*] `/ { print $2 }' "$ROOT_DIR/PROJECT_CONTEXT.md")
  case "$workflow_mode" in
    flexible|custom)
      echo "setup-repo-security: $workflow_mode protection is owned by the product; settings unchanged"
      exit 0
      ;;
    strict)
      if [[ $fork_updates != true ]]; then
        echo "setup-repo-security: strict products must use --fork-updates to preserve update merges" >&2
        exit 1
      fi
      ;;
    *)
      echo "setup-repo-security: missing or ambiguous downstream workflow mode" >&2
      exit 1
      ;;
  esac
fi

need_cmd gh
need_cmd jq

main_ruleset="$RULESET_DIR/main.json"
merge_policy=squash-only
if [[ $fork_updates == true ]]; then
  main_ruleset=$(mktemp)
  trap 'rm -f "$main_ruleset"' EXIT
  jq '.rules |= (map(select(.type != "required_linear_history")) |
    map(if .type == "pull_request" then .parameters.allowed_merge_methods = ["squash", "merge"] else . end))' \
    "$RULESET_DIR/main.json" >"$main_ruleset"
  merge_policy="squash + merge (downstream updates)"
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "setup-repo-security: gh auth status failed; log in with repository admin access first" >&2
  exit 1
fi

repo_json=$(gh repo view --json nameWithOwner)
repo_full_name=$(printf '%s' "$repo_json" | jq -r '.nameWithOwner')
owner=${repo_full_name%/*}
repo=${repo_full_name#*/}

# Read the rulesets endpoint before changing any setting. A private plan may disallow it.
live_rulesets=$(api "repos/$owner/$repo/rulesets")
repo_settings=$(api "repos/$owner/$repo")
visibility=$(jq -er '.visibility' <<<"$repo_settings")
if [[ $fork_updates == true && $visibility == private ]]; then
  private_policy=$(jq '
    (.rules[] | select(.type == "required_status_checks").parameters.required_status_checks)
      |= map(select(.context != "Analyze" and .context != "Dependency review"))
  ' "$main_ruleset")
  printf '%s\n' "$private_policy" > "$main_ruleset"
fi


main_plan=$(plan_ruleset "$owner" "$repo" "$main_ruleset")
tags_plan=$(plan_ruleset "$owner" "$repo" "$RULESET_DIR/tags-release.json")

echo "setup-repo-security: applying security settings to $repo_full_name"

jq -n --argjson fork "$fork_updates" --arg visibility "$visibility" '
  {allow_squash_merge: true, allow_merge_commit: $fork, allow_rebase_merge: false} +
  (if $visibility == "public" then
    {security_and_analysis: {secret_scanning: {status: "enabled"},
      secret_scanning_push_protection: {status: "enabled"}}}
    else {} end)' |
  api --method PATCH "repos/$owner/$repo" --input - >/dev/null

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

echo "setup-repo-security: ensured $merge_policy merges, dependency graph and vulnerability alerts"

apply_ruleset "$main_plan"
apply_ruleset "$tags_plan"

effective=$(api "repos/$owner/$repo/rules/branches/main")
if ! jq -e --argjson plan "$main_plan" '
  . as $effective | all($plan.body.rules[];
    . as $rule | any($effective[]; .type == $rule.type and .parameters == $rule.parameters))
' <<<"$effective" >/dev/null; then
  echo "setup-repo-security: expected strict rules are not effective on main" >&2
  exit 1
fi

echo "setup-repo-security: repository security settings are up to date"
