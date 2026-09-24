#!/usr/bin/env bash
# Gauntlet worktrees (lead tooling): one git worktree per stream for round <N>.
#
#   scripts/gauntlet/worktrees.sh <round> <name> [<name>...]
#   BASE=<ref> scripts/gauntlet/worktrees.sh 2 look ocean ui     # branch from <ref> instead of the main checkout's HEAD
#
# For each name: /tmp/cruise-r<N>-<name> on branch r<N>/<name>, with node_modules symlinked to the main checkout.
# Existing directories are left alone; an existing branch is checked out instead of re-created.
# Remove after merging:  git worktree remove /tmp/cruise-r<N>-<name> && git branch -d r<N>/<name>
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <round> <name> [<name>...]   (env: BASE=<ref>, CRUISE_MAIN=<main checkout>)" >&2
  exit 2
fi
round="$1"; shift
case "$round" in (*[!0-9]*|'') echo "round must be a number, got '$round'" >&2; exit 2;; esac

# The main checkout: first entry of `git worktree list` (works from any worktree of the repo).
main="${CRUISE_MAIN:-$(git worktree list --porcelain | awk 'NR==1 && $1=="worktree" {print $2}')}"
if [ -z "$main" ] || [ ! -d "$main/.git" ]; then
  echo "cannot find the main checkout (set CRUISE_MAIN)" >&2
  exit 1
fi
base="${BASE:-$(git -C "$main" rev-parse --abbrev-ref HEAD)}"
base_sha="$(git -C "$main" rev-parse --short "$base")"
echo "main checkout: $main · base: $base @ $base_sha"

for name in "$@"; do
  case "$name" in (*[!a-z0-9-]*|'') echo "skip '$name': use lowercase letters, digits and dashes" >&2; continue;; esac
  dir="/tmp/cruise-r${round}-${name}"
  branch="r${round}/${name}"
  if [ -e "$dir" ]; then
    echo "exists  $dir (left as is)"
    continue
  fi
  if git -C "$main" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$main" worktree add --quiet "$dir" "$branch"
  else
    git -C "$main" worktree add --quiet -b "$branch" "$dir" "$base"
  fi
  if [ -d "$main/node_modules" ] && [ ! -e "$dir/node_modules" ]; then
    ln -s "$main/node_modules" "$dir/node_modules"
  fi
  echo "created $dir  branch $branch  @ $(git -C "$dir" rev-parse --short HEAD)"
done
