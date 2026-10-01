# Upstream patch ledger

Every fork edit to an upstream-owned file, with the reason, so you can resolve conflicts quickly during `sync-upstream.sh`. Add a row in the same PR as the edit. Fork-owned files (everything under `bishal-patches/`, plus the `CLAUDE.md` symlink) don't need to be listed.

Keep each patch as small and self-contained as possible. If a change grows past a few lines, move the logic into `bishal-patches/` and leave a thin call site in the upstream file.

| File | Change | Why | On conflict |
| ---- | ------ | --- | ----------- |
| `AGENTS.md` | Prepended a block between `<!-- bishal-fork:begin -->` and `<!-- bishal-fork:end -->` | Fork workflow rules (default branch, PR target, `bishal-patches/`) override upstream's `v2` defaults | Keep upstream's text below the block as-is and re-apply the block at the top |
| `package.json` | Added `"bishal-patches/packages/*"` to `workspaces.packages` | Fork-only packages live in `bishal-patches/packages/` | Re-add the glob to upstream's list |
| `packages/cli/src/database-path.ts` | Added `"bishal"` to the channels that use the shared `opencode.db` | Without it, the `bishal` channel would create an empty `opencode-bishal.db` instead of sharing sessions with upstream | Re-add `"bishal"` to whatever list or condition upstream now uses for the shared DB |
