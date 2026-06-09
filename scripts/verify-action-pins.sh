#!/usr/bin/env bash
set -euo pipefail

status=0
count=0

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

  refs=()
  while IFS= read -r ref; do
    refs+=("$ref")
  done < <(
    git ls-remote "https://github.com/$owner/$repo" \
      "refs/tags/$version" \
      "refs/tags/$version^{}"
  )

  if ((${#refs[@]} == 0)); then
    echo "$file:$line: could not resolve tag $version for $owner/$repo" >&2
    status=1
    continue
  fi

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
    echo "$file:$line: could not determine expected commit for $owner/$repo@$version" >&2
    status=1
    continue
  fi

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
