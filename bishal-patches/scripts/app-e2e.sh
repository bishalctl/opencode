#!/usr/bin/env bash
# Run the app's Playwright e2e specs on NixOS with a Nix-provided Chromium.
#   bishal-patches/scripts/app-e2e.sh e2e/regression/bishal-brainstorm.spec.ts [more specs or playwright flags]
set -euo pipefail
worktree="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
cd "$worktree/packages/app"
exec nix shell nixpkgs#chromium --command sh -c \
  'CHROMIUM="$(command -v chromium)" exec bunx playwright test -c playwright.nixos.config.ts "$@"' sh "$@"
