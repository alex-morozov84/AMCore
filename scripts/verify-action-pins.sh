#!/usr/bin/env bash
set -euo pipefail

status=0
count=0

# Cache network resolution by "$owner/$repo@$version" so an action pinned in
# many workflow steps (e.g. actions/checkout, pnpm/action-setup) is only
# looked up once. Each usage line still gets its own reported error/success —
# only the network call behind it is shared. See the incident this fixes:
# many rapid git ls-remote connections in a row (57 before this change) could
# make the very next SSH connection (git push's own) get dropped.
#
# Plain indexed arrays, not `declare -A`: the default macOS /bin/bash is 3.2
# (no associative arrays, added in bash 4.0), and this script also runs
# locally via .husky/pre-push.
cache_keys=()
cache_states=() # parallel to cache_keys: "no_refs" | "no_expected" | "ok"
cache_shas=()   # parallel to cache_keys: expected sha, only meaningful when state is "ok"

while IFS= read -r entry; do
  file=${entry%%:*}
  remainder=${entry#"$file:"}
  line=${remainder%%:*}
  text=${remainder#"$line:"}

  if [[ ! $text =~ ^[[:space:]]*uses:[[:space:]]*([^[:space:]#]+)@([^[:space:]#]+)[[:space:]]*(#[[:space:]]*([^[:space:]]+))?[[:space:]]*$ ]]; then
    echo "$file:$line: unable to parse uses line: $text" >&2
    status=1
    continue
  fi

  action_path=${BASH_REMATCH[1]}
  pin=${BASH_REMATCH[2]}
  version=${BASH_REMATCH[4]:-}

  case "$action_path" in
    ./*|docker://*)
      continue
      ;;
  esac

  if [[ ! $action_path =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(/.*)?$ ]]; then
    continue
  fi

  IFS=/ read -r owner repo _ <<< "$action_path"
  count=$((count + 1))

  if [[ ! $pin =~ ^[0-9a-f]{40}$ ]]; then
    echo "$file:$line: $action_path must use a full 40-character SHA pin" >&2
    status=1
    continue
  fi

  if [[ -z $version ]]; then
    echo "$file:$line: $action_path is missing a trailing # <version> comment" >&2
    status=1
    continue
  fi

  cache_key="$owner/$repo@$version"

  cache_idx=-1
  for i in "${!cache_keys[@]}"; do
    if [[ ${cache_keys[$i]} == "$cache_key" ]]; then
      cache_idx=$i
      break
    fi
  done

  if ((cache_idx == -1)); then
    refs=()
    while IFS= read -r ref; do
      refs+=("$ref")
    done < <(
      git ls-remote "https://github.com/$owner/$repo" \
        "refs/tags/$version" \
        "refs/tags/$version^{}"
    )

    cache_idx=${#cache_keys[@]}
    cache_keys+=("$cache_key")

    if ((${#refs[@]} == 0)); then
      cache_states+=("no_refs")
      cache_shas+=("")
    else
      expected=""
      for ref in "${refs[@]}"; do
        sha=${ref%%$'\t'*}
        name=${ref#*$'\t'}
        if [[ $name == "refs/tags/$version^{}" ]]; then
          expected=$sha
          break
        fi
        if [[ -z $expected && $name == "refs/tags/$version" ]]; then
          expected=$sha
        fi
      done

      if [[ -z $expected ]]; then
        cache_states+=("no_expected")
        cache_shas+=("")
      else
        cache_states+=("ok")
        cache_shas+=("$expected")
      fi
    fi
  fi

  if [[ ${cache_states[$cache_idx]} == no_refs ]]; then
    echo "$file:$line: could not resolve tag $version for $owner/$repo" >&2
    status=1
    continue
  fi

  if [[ ${cache_states[$cache_idx]} == no_expected ]]; then
    echo "$file:$line: could not determine expected commit for $owner/$repo@$version" >&2
    status=1
    continue
  fi

  expected=${cache_shas[$cache_idx]}

  if [[ $pin != "$expected" ]]; then
    echo "$file:$line: $action_path pin $pin does not match $version commit $expected" >&2
    status=1
    continue
  fi
done < <(grep -EnH '^[[:space:]]*uses:[[:space:]]*' .github/workflows/*.yml)

if [[ $status -eq 0 ]]; then
  echo "Verified $count pinned action references."
fi

exit $status
