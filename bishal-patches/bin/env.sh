# Shared environment for the fork launchers. Source it; don't execute it.
#
# Uses the same data dirs as the daily upstream v2 install (`oc2` / `opencode-v2-desktop`,
# see /etc/nixos/pkgs/opencode-v2/package.nix) so projects, sessions, config and auth are
# shared. Isolation from upstream comes from the fork's channel (service file + port) and
# the desktop's dev identity, not from separate dirs.

OCB_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export XDG_CONFIG_HOME="${OPENCODE_V2_CONFIG_HOME:-$HOME/.config/opencode-v2}"
export XDG_DATA_HOME="${OPENCODE_V2_DATA_HOME:-$HOME/.local/share/opencode-v2}"
export XDG_CACHE_HOME="${OPENCODE_V2_CACHE_HOME:-$HOME/.cache/opencode-v2}"
export XDG_STATE_HOME="${OPENCODE_V2_STATE_HOME:-$HOME/.local/state/opencode-v2}"

runtime_root="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}/opencode-v2-$UID}"
export OPENCODE_PTY_RUNTIME_DIR="${OPENCODE_V2_PTY_RUNTIME_DIR:-$runtime_root/opencode-pty}"

# A fork build must never replace itself with an upstream release.
export OPENCODE_DISABLE_AUTOUPDATE=1

# Version tracks the checkout so a code change makes the CLI replace a stale fork daemon
# (the client restarts a registered service whose version differs).
ocb_version() {
  local sha dirty
  sha="$(git -C "$OCB_REPO" rev-parse --short HEAD)"
  dirty="$(git -C "$OCB_REPO" diff HEAD | sha1sum | cut -c1-8)"
  [ "$dirty" = "da39a3ee" ] && dirty="clean"
  echo "0.0.0-bishal-dev.$sha.$dirty"
}
