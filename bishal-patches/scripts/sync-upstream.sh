#!/usr/bin/env bash
# Merge the latest upstream v2 into a fresh sync branch off main/bishal.
#
#   bishal-patches/scripts/sync-upstream.sh            # sync branch + worktree, merge, stop
#   bishal-patches/scripts/sync-upstream.sh --pr       # also push and open a PR to main/bishal
#
# Always merges (never rebases): main/bishal is shared and pushed.
# On conflicts the script stops inside the sync worktree so you can resolve,
# `git commit`, then re-run with --pr (or push + open the PR by hand).
set -euo pipefail

open_pr=false
[ "${1:-}" = "--pr" ] && open_pr=true

worktree="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
root="$(dirname "$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)")"
[ -d "$root/.bare" ] || { echo "expected bare layout root at $root" >&2; exit 1; }

git -C "$root" fetch upstream v2
git -C "$root" fetch origin
# Keep the fork's v2 an exact mirror of upstream.
git -C "$root" push origin upstream/v2:refs/heads/v2

base="origin/main/bishal"
behind="$(git -C "$root" rev-list --count "$base..upstream/v2")"
if [ "$behind" = 0 ]; then
  echo "main/bishal already contains upstream/v2 — nothing to sync."
  exit 0
fi
echo "upstream/v2 has $behind new commit(s) not in main/bishal."

branch="chore/sync-v2-$(date +%Y%m%d)"
dir="$root/$branch"
if [ ! -d "$dir" ]; then
  git -C "$root" worktree add -b "$branch" "$dir" "$base"
fi

cd "$dir"
if ! git merge --no-ff --no-edit -m "chore: merge upstream v2 ($(git rev-parse --short upstream/v2))" upstream/v2; then
  echo
  echo "Merge conflicts in $dir:"
  git diff --name-only --diff-filter=U
  echo
  echo "Resolve them (check bishal-patches/PATCHES.md for why each upstream file was touched),"
  echo "then: git -C $dir commit && $0 --pr"
  exit 1
fi

if [ "$open_pr" = true ]; then
  git push -u origin "$branch"
  gh pr create --repo bishalctl/opencode --base main/bishal --head "$branch" \
    --title "chore: merge upstream v2" \
    --body "Merges $behind upstream \`v2\` commit(s) up to $(git rev-parse --short upstream/v2)."
fi
echo "Synced in $dir (branch $branch)."
