# /brainstorm — persistent side chat (fork feature)

A side conversation attached to a main session. It sees the main chat's live context, keeps its own conversation, model, effort, and agent, and never writes into the main chat. Upstream's one-shot `/btw` (`packages/gui-extensions/src/btw`, `packages/tui/src/feature-plugins/prompt/btw.tsx`) stays untouched; everything here is namespaced `brainstorm`.

## Behavior

- **Context** = main session's settled history (re-read on every brainstorm step) + the brainstorm's own messages. If main is mid-turn, a short status note ("main is working on …, running …") follows the settled part; partial output is never included.
- **Isolation**: brainstorm messages are stored only in the brainstorm session; main never sees them.
- **One brainstorm per main session**, persistent. Closing the panel hides it; reopening shows the same thread.
  - **Compact** compacts the brainstorm's own messages only.
  - **Clear** starts a fresh brainstorm thread and keeps the model/effort/agent choice.
- **Settings per brainstorm**: model and effort (variant) default to main's; agent defaults to the read-only `brainstorm` agent (read/grep/glob/web, no edit/bash/write).
- **Context display**: combined gauge (main share + brainstorm share / model limit) and a note of how far into main the included context reaches.
- **Open**: web/desktop session-header button or `/brainstorm [text]`; CLI `/brainstorm [text]` or keybind opens a docked side pane (fullscreen on narrow terminals).

## Architecture

```
            ┌──────────────── server (core runner, unchanged) ─────────────────┐
            │  main session S ── history ──┐                                   │
            │                              │ session.context(S), every step    │
            │  brainstorm B (child of S) ──┼─▶ "context" hook (brainstorm plugin)│
            │   own model/effort/agent     │   messages = [S settled] + note    │
            │   own messages only          │              + [B own]            │
            │                              │                                   │
            │  RPC "brainstorm": ensure / clear / usage  (+ events)            │
            └───────────────▲───────────────────────────▲──────────────────────┘
                            │ client.rpc + session APIs  │
        ┌───────────────────┴────────────┐   ┌───────────┴─────────────────────┐
        │ GUI extension (web/desktop)    │   │ TUI plugin (CLI)                 │
        │ header button, /brainstorm,    │   │ /brainstorm + keybind,           │
        │ side Panel: timeline, composer,│   │ session.panel pane: transcript,  │
        │ pickers, context gauge,        │   │ composer, pickers, gauge,        │
        │ compact / clear                │   │ compact / clear                  │
        └────────────────────────────────┘   └──────────────────────────────────┘
```

- **Brainstorm = hidden child session** (`parentID` = main, tagged `metadata.brainstorm`). Child sessions already get streaming, tools, retries, compaction, per-session model/variant/agent, usage, list hiding (lists filter `parentID: null`), and cascade delete.
- **Shared contract** (`packages/schema/src/bishal/brainstorm.ts`, `@opencode/schema/bishal/brainstorm`): RPC definition, metadata key, `mainOf()`. Lives in schema because clients may depend on schema but never on core.
- **Server plugin** (`packages/core/src/plugin/bishal/brainstorm.ts`, registered after `PlanPlugin` in `core/src/plugin/internal.ts`). It lives inside core rather than in `bishal-patches/packages/` because it reuses core's `toLLMMessages`, and a separate package depending on core while core registers it would be a workspace cycle.
  - `context` session hook (fires for every primary step, `core/src/session/model-request.ts` `primary`): for a tagged session, prepend the parent's settled history (converted with core's `toLLMMessages` for the brainstorm's model) plus a boundary note. Not applied to the `compaction` hook, so brainstorm compaction only summarizes its own messages.
  - Agent transform adds the read-only `brainstorm` agent.
  - RPC `brainstorm` (typed, `POST /api/rpc/brainstorm/:method`, no protocol/codegen edits): `ensure(mainID)` → the one brainstorm session (create on first use with main's model/variant), `clear(mainID)`, `usage(brainstormID)`.
- **GUI** (`packages/gui-extensions/src/brainstorm/`, public extension SDK only): `session.header` slot button, `Command` with `slash: brainstorm` + rebindable keybind, non-transient side `Panel` rendering upstream `SessionTimeline`, its own composer, model/effort/agent pickers, gauge, compact/clear.
- **TUI** (`packages/tui/src/feature-plugins/brainstorm/`, in-tree to reuse `Prompt`): keymap command + slash, `ui.panel.open("brainstorm")`, `session.panel` slot render (first user of that slot), transcript from message data, pickers via dialogs, gauge, compact/clear.
- **Context math**: the brainstorm's last assistant usage is the true combined input. Main share = main's last usage; brainstorm share = remainder. `usage` RPC returns both so the UIs agree.
- **Prompt cache**: same model + tools as main means the brainstorm request is main's cached prefix + a tail. Keep main's tool definitions (old tool-call history needs them on some providers) and restrict with permissions. A model switch costs one uncached prefix, then caches again.

## Upstream touches (record in PATCHES.md)

One-line registrations in `packages/core/src/plugin/internal.ts` (done), `packages/gui-extensions/src/renderer.ts` + `main.ts`, `packages/tui/src/plugin/builtins.ts`; possibly a filter in `packages/app/src/session/requests/background.ts` so a busy brainstorm isn't listed as a main-session subagent task. Everything else is fork-owned folders (`*/bishal/`, `*/brainstorm/`). No new packages, dependencies, or `bun.lock` changes.

## Spike findings (phase 1)

- Proven by `packages/core/test/plugin/bishal-brainstorm.test.ts` against real sessions and bus-projected history: one thread per main session; main's settled history prepended before the brainstorm's own messages; re-read on every step (main's new turns appear without resync); unfinished main output excluded with a "still working (running: …)" note; main's own requests untouched; clear keeps model and agent.
- Compaction: the "due" check measures from the brainstorm's last provider-reported usage, which already includes the injected main context, so it is accurate after the first reply. Gaps: main growth since that reply, and the very first brainstorm request, are not estimated; both fall back to the runner's overflow-compaction retry. If main alone exceeds the brainstorm model's window the request fails; the fix is compacting main or picking a larger-window model.

## Phases

1. **Spike**: server plugin + tests proving hook injection (main context visible, isolation, freshness, in-progress note). Check: compaction "due" ignores the injected prefix (overflow retry should cover it), tool-history/tool-definition requirements, child-session side effects (background task list, request dock, subagent depth).
2. **Server**: agent, hook, RPC (`ensure`/`clear`/`usage`), core-level tests.
3. **Web/desktop panel**, e2e against the fork daemon.
4. **CLI pane**.
5. **Extras**: send-to-main (insert into main composer), promote to fork (after upstream #50391), default brainstorm model setting.

## Rejected alternatives

- One-shot `session.generate` (btw style): no conversation, streaming, persistence, or usage.
- Fork per prompt: O(history) copy per prompt, stale, loses brainstorm turns, forks are top-level sessions.
- Core "inherit parent context" flag: sturdier compaction accounting but touches schema/projector/migration/protocol that upstream is actively changing (#50391, #52437). Fallback if the spike shows the hook is insufficient.
