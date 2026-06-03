#!/usr/bin/env bash
# Pre-commit / pre-push security gates. Fails if secret-like paths are staged or tracked keypairs exist.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

fail=0

blocked_patterns=(
  '\.env$'
  '\.env\.'
  'provider\.compose\.env$'
  'oracle-keypair\.json$'
  'treasury-keypair\.json$'
  'provider-keypair\.json$'
  '\.pem$'
  '\.key$'
  'jwt\.txt$'
)

echo "==> Checking staged files for secret paths (add/modify only)..."
while IFS= read -r -d '' f; do
  for pat in "${blocked_patterns[@]}"; do
    if [[ "$f" =~ $pat ]] && [[ ! "$f" =~ \.example$ ]]; then
      echo "BLOCKED staged file: $f (matches $pat)"
      fail=1
    fi
  done
done < <(git diff --cached --diff-filter=AM --name-only -z 2>/dev/null || true)

echo "==> Checking git index for tracked keypair files..."
tracked="$(git ls-files '*.keypair.json' 'infra/oracle-keypair.json' 'treasury-keypair.json' 'provider-keypair.json' 2>/dev/null | grep -v '\.example$' || true)"
if [[ -n "$tracked" ]]; then
  echo "BLOCKED: keypair files must not be tracked in git:"
  echo "$tracked"
  fail=1
fi

if command -v gitleaks >/dev/null 2>&1; then
  echo "==> Running gitleaks (staged + working tree)..."
  if ! gitleaks protect --staged --config "$REPO_ROOT/.gitleaks.toml" --verbose; then
    fail=1
  fi
else
  echo "==> gitleaks not installed; skipping (install for full secret scan)"
fi

if [[ "$fail" -ne 0 ]]; then
  echo ""
  echo "Security gate failed. See docs/SECURITY_GATES.md"
  exit 1
fi

echo "Security gate passed."
