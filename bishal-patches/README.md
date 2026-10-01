# bishal-patches

Fork-owned code, scripts, and docs for `bishalctl/opencode`. Everything the fork adds lives here, so syncing from upstream `v2` touches as few upstream files as possible. Every unavoidable edit to an upstream file is recorded in [`PATCHES.md`](./PATCHES.md).

```
bishal-patches/
  bin/        launchers: ocb (CLI/TUI/server), ocb-desktop, ocb-web, plus env.sh shared by all three
  scripts/    fork maintenance (sync-upstream.sh)
  packages/   fork-only workspace packages (bishal-patches/packages/* is in the root workspaces)
  PATCHES.md  ledger of every upstream file the fork modifies
```

## Layout and remotes

```
~/personal/opencode/
  .bare/            bare repo
  .git              gitdir: ./.bare
  AGENTS.md         -> main/bishal/AGENTS.md (CLAUDE.md -> AGENTS.md)
  main/bishal/      default branch worktree
  <feature>/        one sibling worktree per feature branch
```

| Remote     | URL                    | Use                                                    |
| ---------- | ---------------------- | ------------------------------------------------------ |
| `origin`   | `bishalctl/opencode`   | the fork; `main/bishal` is the default branch          |
| `upstream` | `anomalyco/opencode`   | fetches `v2` only; push URL is `DISABLED`              |

`gh` is pinned to `bishalctl/opencode` (`gh repo set-default`), so `gh pr create` targets the fork, not upstream.

## Feature workflow

```sh
cd ~/personal/opencode/main/bishal
git pull
git worktree add -b my-feature ../../my-feature main/bishal
cd ../../my-feature && bun install
# ...work, commit...
git push -u origin my-feature
gh pr create --repo bishalctl/opencode --base main/bishal
```

When the PR is merged, run `git worktree remove ~/personal/opencode/my-feature && git branch -d my-feature`.

## Syncing upstream v2

```sh
bishal-patches/scripts/sync-upstream.sh        # fetch, mirror origin/v2, merge into a sync-v2-<date> worktree
bishal-patches/scripts/sync-upstream.sh --pr   # same, then push and open the PR to main/bishal
```

It always merges and never rebases, since `main/bishal` is published. If the merge conflicts, resolve it in the sync worktree using `PATCHES.md` (it explains why each upstream file was touched), commit, then rerun with `--pr`.

## Running the fork alongside upstream

The daily upstream v2 install (`oc2`, `opencode-v2-desktop`, built by `/etc/nixos/pkgs/opencode-v2`) and the fork share the same data dirs:

- `~/.config/opencode-v2`
- `~/.local/share/opencode-v2`
- `~/.cache/opencode-v2`
- `~/.local/state/opencode-v2`

So projects, sessions, config, and auth are shared. Each side runs its own processes:

|                    | upstream (`oc2`)                    | fork CLI/TUI (`ocb`)                         | fork desktop (`ocb-desktop`)                                  |
| ------------------ | ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| channel            | `latest`                            | `bishal`                                     | `local` (forced by `packages/desktop/scripts/dev.ts`)         |
| service file       | `state/opencode/service.json`       | `state/opencode/service-bishal.json`         | inside the desktop's userData                                 |
| daemon port        | 49374                               | 32903                                        | 3084, bound to `0.0.0.0` (password-protected)                 |
| database           | `opencode.db`                       | `opencode.db` (patched, see `PATCHES.md`)    | `opencode.db` (`OPENCODE_DB`)                                 |
| TUI state          | `state/opencode/latest/tui`         | `state/opencode/bishal/tui`                  | n/a                                                           |
| desktop identity   | `ai.opencode.desktop`               | n/a                                          | `ai.opencode.desktop.dev` (own userData + single-instance lock) |
| updater            | on                                  | off (`OPENCODE_DISABLE_AUTOUPDATE`)          | off (dev channel)                                             |

```sh
B=~/personal/opencode/main/bishal/bishal-patches/bin
$B/ocb                       # TUI in the current project, against the fork daemon
$B/ocb service status        # fork daemon URL; also serves the web UI
$B/ocb service restart
$B/ocb-web                   # Vite dev server for packages/app on :3100 → fork daemon
$B/ocb-desktop               # Electron dev build
```

Each launcher runs the code of the worktree it lives in. `ocb` stamps its version as `0.0.0-bishal-dev.<sha>.<diff-hash>`, so when the code changes, the next `ocb` run replaces the running fork daemon. Untracked files don't change the stamp; run `ocb service restart` after adding new files. All worktrees share the one `bishal` service, so the worktree launched last owns it.

### Caveats

- **Shared DB, shared schema.** The upstream daemon migrates and reads the same `opencode.db`. Don't ship fork-only DB migrations without a plan. Test schema work against a scratch DB: `OPENCODE_DB=opencode-scratch.db ocb ...`.
- **Never run `ocb uninstall`.** It deletes the shared data, config, cache, and state dirs and stops every `service*.json` daemon, including upstream's.
- **`BUN_OPTIONS` is inherited.** `ocb` passes its defines and bunfig through `BUN_OPTIONS` so the daemon respawn keeps them. Bun processes started from fork sessions (for example `bun test` run by the agent) inherit those flags. That's harmless unless the code references an `OPENCODE_CHANNEL` global.
- **Desktop server is separate from `ocb`'s.** `ocb-desktop` uses upstream's isolated dev-server mode, so it runs its own daemon rather than attaching to the `bishal` one. Both write to the same DB, but live events don't cross between them.
- **The desktop inherits your login shell's environment.** At startup it merges the login-shell env over its own, and it drops `XDG_STATE_HOME` if the shell doesn't set it. Don't export XDG overrides in the shell profile, or the desktop will ignore the launcher's dirs.
