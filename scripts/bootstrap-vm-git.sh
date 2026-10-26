#!/usr/bin/env bash
# ==============================================================================
# Give /opt/proxyhubb on the GCP testnet VM a git checkout, in place.
#
# Why: scripts/gcp-ci-deploy.sh and .github/workflows/deploy-gcp-testnet.yml both
# start with `git fetch origin main && git reset --hard origin/main`, but the VM
# tree was populated from a tarball and has no .git, so neither can run.
#
# How: adopt the existing tree instead of re-cloning. HEAD and the index are
# pointed at origin/main WITHOUT touching the working tree, so .env*, backups,
# rollback material and every other untracked file stay exactly where they are.
# If any tracked file on disk differs from origin/main the script lists them and
# stops, so nothing is silently overwritten by a later `reset --hard`.
#
# Run as root on the VM (the tree is root-owned, so the deploy's git steps must
# run as root too - use `sudo git ...` / `sudo bash scripts/gcp-ci-deploy.sh`):
#
#   sudo bash scripts/bootstrap-vm-git.sh          # 1st run: creates key, prints pubkey
#   # add the printed key as a READ-ONLY deploy key on the GitHub repo, then:
#   sudo bash scripts/bootstrap-vm-git.sh          # 2nd run: adopts the tree
#
# Env overrides: DIR, REPO_URL, KEY, BRANCH.
# PROXYHUBB_BOOTSTRAP_TEST=1 skips the root check, key handling and ssh config so
# the adoption logic can be exercised against a local repo path.
# ==============================================================================

set -euo pipefail

DIR="${DIR:-/opt/proxyhubb}"
REPO_URL="${REPO_URL:-git@github.com:samuel-1-avson/ProxySocialHub.git}"
KEY="${KEY:-/root/.ssh/proxyhubb_deploy_ed25519}"
KNOWN_HOSTS="${KNOWN_HOSTS:-/root/.ssh/known_hosts_github}"
BRANCH="${BRANCH:-main}"
TEST_MODE="${PROXYHUBB_BOOTSTRAP_TEST:-0}"

if [[ "$TEST_MODE" != "1" && "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo): $DIR is root-owned." >&2
  exit 1
fi
[[ -d "$DIR" ]] || { echo "No such directory: $DIR" >&2; exit 1; }

if [[ "$TEST_MODE" != "1" ]]; then
  mkdir -p "$(dirname "$KEY")"
  chmod 700 "$(dirname "$KEY")"

  # 1. Deploy key (private half never leaves the VM).
  if [[ ! -f "$KEY" ]]; then
    ssh-keygen -q -t ed25519 -N '' -C "proxyhubb-testnet-deploy" -f "$KEY"
    echo
    echo "Created deploy key. Add this public key to the repo as a READ-ONLY deploy key"
    echo "(GitHub > repo > Settings > Deploy keys, leave 'Allow write access' OFF), then re-run:"
    echo
    cat "$KEY.pub"
    echo
    exit 0
  fi

  # 2. Pin GitHub's SSH host keys from the TLS-authenticated meta endpoint,
  #    not trust-on-first-use.
  python3 - "$KNOWN_HOSTS" <<'PY'
import json, sys, urllib.request
keys = json.load(urllib.request.urlopen("https://api.github.com/meta", timeout=15))["ssh_keys"]
with open(sys.argv[1], "w") as f:
    f.writelines(f"github.com {k}\n" for k in keys)
PY
  chmod 600 "$KNOWN_HOSTS"
fi

cd "$DIR"

# 3. Repo + remote. The key is pinned in repo config so `sudo git ...` works from
#    any HOME, including from the deploy workflow.
[[ -d .git ]] || git init -q -b "$BRANCH"
if git remote get-url origin >/dev/null 2>&1; then git remote set-url origin "$REPO_URL"; else git remote add origin "$REPO_URL"; fi
if [[ "$TEST_MODE" != "1" ]]; then
  git config core.sshCommand "ssh -i $KEY -o IdentitiesOnly=yes -o UserKnownHostsFile=$KNOWN_HOSTS -o StrictHostKeyChecking=yes"
fi
# The tree came from a tarball: ignore mode/line-ending noise and the 20k+
# untracked files (build output, backups) so `git status` stays usable.
git config core.fileMode false
git config core.autocrlf false
git config status.showUntrackedFiles no

# 4. Fetch, then adopt: HEAD + index = origin/<branch>, working tree untouched.
git fetch --depth=50 origin "$BRANCH"
git symbolic-ref HEAD "refs/heads/$BRANCH"
git update-ref "refs/heads/$BRANCH" "origin/$BRANCH"
git branch -q --set-upstream-to="origin/$BRANCH" "$BRANCH" 2>/dev/null || git fetch origin "$BRANCH:refs/remotes/origin/$BRANCH" >/dev/null 2>&1 || true
git read-tree "origin/$BRANCH"

# 5. Verify: any tracked file whose content differs from origin/<branch> would be
#    overwritten by the deploy's `git reset --hard`. Differences that are only
#    CRLF vs LF are expected (a tarball built by `git archive` on Windows has CRLF
#    everywhere, which breaks `bash scripts/*.sh`) and are fixed by that reset, so
#    count them; anything else is listed and stops the script.
#    One numstat call, not one process per file (2,800+ files): after ignoring CR,
#    a file with real changes has added/removed lines (or '-' for binary); a
#    CR-only file has none (older gits print 0/0, newer ones omit the entry).
CONTENT=()
while IFS=$'\t' read -r added removed f; do
  [[ -e "$f" ]] || continue # deleted files are reported separately below
  [[ "$added" == 0 && "$removed" == 0 ]] || CONTENT+=("$f")
done < <(git diff --no-renames --ignore-cr-at-eol --numstat)
ALL_DIFFERING=$(git diff --no-renames --name-only | wc -l)
EOL_ONLY=$((ALL_DIFFERING - ${#CONTENT[@]}))
DELETED="$(git ls-files --deleted)"

if [[ ${#CONTENT[@]} -gt 0 || -n "$DELETED" ]]; then
  echo
  echo "Tracked files whose content differs from origin/$BRANCH (the deploy's reset --hard WOULD overwrite these):"
  for f in "${CONTENT[@]}"; do echo "  modified: $f"; done
  [[ -z "$DELETED" ]] || sed 's/^/  missing:  /' <<<"$DELETED"
  echo
  echo "Review them (git diff -- <file>), keep anything you need, then re-run this script."
  exit 2
fi

echo
echo "OK: $DIR is now a git checkout at $(git rev-parse --short HEAD) ($(git log -1 --format=%s | cut -c1-70))"
echo "    no tracked file differs in content from origin/$BRANCH; untracked files untouched."
if [[ $EOL_ONLY -gt 0 ]]; then
  echo "    $EOL_ONLY tracked files differ only in line endings (CRLF on disk, LF in git)."
  echo "    The deploy's 'git reset --hard' rewrites them as LF, which is what makes scripts/*.sh runnable."
fi
