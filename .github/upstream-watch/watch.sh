#!/usr/bin/env bash
# Test-rebase the fork onto an upstream tag and print a Markdown report on stdout.
# Never pushes, tags, or moves a branch. Usage: watch.sh --tag <upstream tag>
set -euo pipefail

UPSTREAM_REPO="kaitranntt/ccs"

usage() {
  echo "usage: $0 --tag <upstream tag>" >&2
  exit 2
}

TAG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$TAG" ] || usage

ROOT=$(git rev-parse --show-toplevel)
CHECKS="$ROOT/.github/upstream-watch/checks.tsv"

VERSION=$(git -C "$ROOT" show main:package.json | jq -r .version)
BASE="${VERSION%-retso.*}"
git -C "$ROOT" rev-parse -q --verify "refs/tags/v$BASE^{commit}" >/dev/null \
  || { echo "base tag v$BASE not found; fetch upstream tags first" >&2; exit 1; }
git -C "$ROOT" rev-parse -q --verify "refs/tags/$TAG^{commit}" >/dev/null \
  || { echo "tag $TAG not found; fetch upstream tags first" >&2; exit 1; }

PUBLISHED=$(gh release view "$TAG" --repo "$UPSTREAM_REPO" --json publishedAt --jq .publishedAt 2>/dev/null || true)
PUBLISHED="${PUBLISHED%%T*}"
[ -n "$PUBLISHED" ] || PUBLISHED=$(git -C "$ROOT" log -1 --format=%cs "$TAG")

WT=$(mktemp -d "${TMPDIR:-/tmp}/upstream-watch.XXXXXX")
LOG=$(mktemp "${TMPDIR:-/tmp}/upstream-watch-log.XXXXXX")
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true
  rm -rf "$WT" "$LOG"
  git -C "$ROOT" worktree prune
}
trap cleanup EXIT

git -C "$ROOT" worktree add --detach "$WT" "$TAG" >&2

wtgit() {
  git -C "$WT" -c user.name=upstream-watch -c user.email=upstream-watch@users.noreply.github.com "$@"
}

APPLIED=0
CONFLICTS=0
CONFLICT_LINES=""
ALREADY_LINES=""

for sha in $(git -C "$ROOT" rev-list --reverse --no-merges "v$BASE..main"); do
  subject=$(git -C "$ROOT" log -1 --format=%s "$sha")
  case "$subject" in chore\(release\)*) continue ;; esac
  if wtgit cherry-pick "$sha" >/dev/null 2>"$LOG"; then
    APPLIED=$((APPLIED + 1))
    continue
  fi
  files=$(git -C "$WT" diff --name-only --diff-filter=U | paste -sd, -)
  if [ -z "$files" ]; then
    wtgit cherry-pick --skip >/dev/null 2>&1 || wtgit cherry-pick --abort >/dev/null 2>&1 || true
    ALREADY_LINES="$ALREADY_LINES- \`$subject\`"$'\n'
  else
    wtgit cherry-pick --abort >/dev/null 2>&1 || true
    CONFLICTS=$((CONFLICTS + 1))
    CONFLICT_LINES="$CONFLICT_LINES- \`$subject\` — $files"$'\n'
  fi
done

VALIDATE="not run (a commit conflicted, so the tree is missing fork commits)"
RESULT="$CONFLICTS commits conflict"
if [ "$CONFLICTS" -eq 0 ]; then
  if (cd "$WT" && HUSKY=0 bun install && bun run validate) >"$LOG" 2>&1; then
    VALIDATE="passed"
    RESULT="clean rebase, validate passed"
  else
    VALIDATE=$'failed — last 50 lines:\n\n```\n'"$(tail -n 50 "$LOG")"$'\n```'
    RESULT="clean rebase, validate failed"
  fi
fi

UNNEEDED=""
if [ -f "$CHECKS" ]; then
  while IFS=$'\t' read -r dname fpath pattern subjects; do
    [ -n "$dname" ] || continue
    if git -C "$ROOT" grep -q -F -e "$pattern" "$TAG" -- "$fpath"; then
      UNNEEDED="$UNNEEDED- **$dname** — \`$fpath\` now contains \`$pattern\`. Unneeded fork commits: $subjects"$'\n'
    fi
  done <"$CHECKS"
fi

echo "## Upstream $TAG (published $PUBLISHED)"
echo
echo "**Result:** $RESULT"
echo
echo "### Rebase"
echo
echo "Fork base \`v$BASE\`; test rebase onto \`$TAG\`: $APPLIED applied, $CONFLICTS conflicting."
if [ -n "$CONFLICT_LINES" ]; then
  echo
  printf '%s' "$CONFLICT_LINES"
fi
if [ -n "$ALREADY_LINES" ]; then
  echo
  echo "Already in upstream (empty after applying):"
  echo
  printf '%s' "$ALREADY_LINES"
fi
echo
echo "### Validate"
echo
echo "$VALIDATE"
echo
echo "### Fork commits upstream made unneeded"
echo
if [ -n "$UNNEEDED" ]; then
  printf '%s' "$UNNEEDED"
else
  echo "None."
fi
