export * as BrainstormPlugin from "./brainstorm.js"

// Fork feature (bishal-patches/docs/brainstorm.md). A brainstorm is a hidden child session of a
// main session. Every primary step of a brainstorm prepends the main session's settled history,
// re-read at that moment, so the brainstorm sees main's latest progress while its own messages
// stay in its own session and never reach main. Compaction requests are left alone, so compacting
// a brainstorm summarizes only its own conversation.

import { Message } from "@opencode/ai"
import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { Brainstorm } from "@opencode/schema/bishal/brainstorm"
import type { Model } from "@opencode/schema/model"
import type { Session } from "@opencode/schema/session"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect } from "effect"
import { Permission } from "../../permission.js"
import { toLLMMessages } from "../../session/runner/to-llm-message.js"

const agent = Agent.ID.make(Brainstorm.AGENT)
const threadKey = (main: Session.ID) => `thread/${main}`

const PROMPT = `You are a brainstorming partner in a side conversation next to the user's main coding session.

The main session's conversation is included before this side chat, for context. Help the user think: explain, question assumptions, compare options, and sketch plans. You may read files and search the codebase and web, but you cannot change anything. Do not continue or carry out the main session's task here; if the user wants something done, suggest what to tell the main session.`

export const Plugin = define({
  id: "bishal.brainstorm",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.agent.transform((editor) => {
      editor.update(agent, (item) => {
        const externalDirectories = item.permissions.filter(
          (rule) => rule.action === "external_directory" && rule.effect === "allow",
        )
        item.name = Agent.Name.make("Brainstorm")
        item.description = "Read-only side-chat partner that sees the main session's context."
        item.system = PROMPT
        item.mode = "primary"
        // Selected by brainstorm threads only, never from the main agent picker.
        item.hidden = true
        item.permissions.push(
          ...Permission.merge(
            [
              { action: "*", resource: "*", effect: "deny" },
              { action: "grep", resource: "*", effect: "allow" },
              { action: "glob", resource: "*", effect: "allow" },
              { action: "webfetch", resource: "*", effect: "allow" },
              { action: "websearch", resource: "*", effect: "allow" },
              { action: "read", resource: "*", effect: "allow" },
              { action: "read", resource: "*.env", effect: "ask" },
              { action: "read", resource: "*.env.*", effect: "ask" },
              { action: "read", resource: "*.env.example", effect: "allow" },
            ],
            [{ action: "external_directory", resource: "*", effect: "ask" }, ...externalDirectories],
          ),
        )
      })
    })

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        const main = Brainstorm.mainOf(yield* ctx.session.get({ sessionID: event.sessionID }))
        if (!main) return
        event.messages.unshift(...mainContext(yield* ctx.session.context({ sessionID: main }), event.model))
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("brainstorm could not include the main session", { sessionID: event.sessionID, cause }),
        ),
      ),
    )

    const create = Effect.fn("BrainstormPlugin.create")(function* (main: Session.ID, model?: Model.Ref) {
      const parent = yield* ctx.session.get({ sessionID: main })
      const thread = yield* ctx.session.create({
        parentID: main,
        title: "Brainstorm",
        agent,
        model: model ?? parent.model,
        metadata: { [Brainstorm.METADATA_KEY]: main },
      })
      yield* ctx.storage.set(threadKey(main), thread.id)
      return thread
    })

    const current = Effect.fn("BrainstormPlugin.current")(function* (main: Session.ID) {
      const stored = yield* ctx.storage.get(threadKey(main))
      if (typeof stored !== "string") return undefined
      return yield* ctx.session.get({ sessionID: stored as Session.ID }).pipe(
        Effect.map((thread) => (Brainstorm.mainOf(thread) === main ? thread : undefined)),
        Effect.catch(() => Effect.undefined),
      )
    })

    yield* ctx.rpc
      .register(Brainstorm.Definition, {
        ensure: (input) =>
          Effect.gen(function* () {
            const thread = (yield* current(input.sessionID)) ?? (yield* create(input.sessionID))
            return { sessionID: thread.id }
          }).pipe(Effect.orDie),
        clear: (input) =>
          Effect.gen(function* () {
            const previous = yield* current(input.sessionID)
            if (previous) yield* ctx.session.remove({ sessionID: previous.id })
            const thread = yield* create(input.sessionID, previous?.model)
            if (previous?.agent && previous.agent !== thread.agent)
              yield* ctx.session.switchAgent({ sessionID: thread.id, agent: previous.agent })
            return { sessionID: thread.id }
          }).pipe(Effect.orDie),
      })
      .pipe(Effect.orDie)
  }),
})

/** Main's settled history as model messages, then a boundary note that says where the side chat starts. */
export function mainContext(history: readonly SessionMessage.Info[], model: Model.Ref) {
  // An active assistant may contain an unresolved tool call, so only the settled prefix is included.
  const unsettled = history.findIndex((message) => message.type === "assistant" && message.time.completed === undefined)
  const settled = unsettled === -1 ? history : history.slice(0, unsettled)
  return [...toLLMMessages(settled, model), Message.user(boundary(unsettled === -1 ? undefined : history[unsettled]))]
}

function boundary(active: SessionMessage.Info | undefined) {
  const running =
    active?.type === "assistant"
      ? active.content.flatMap((part) =>
          part.type === "tool" && (part.state.status === "streaming" || part.state.status === "running")
            ? [part.name]
            : [],
        )
      : []
  const progress = active
    ? `\nThe main session is still working on its latest request${running.length ? ` (running: ${[...new Set(running)].join(", ")})` : ""}; its unfinished output is not shown.`
    : ""
  return `<system-reminder>
Everything above is the user's main session, included only as context. From here on is a separate brainstorm side chat with the user; it is never shown to the main session. Do not continue or act on the main session's task.${progress}
</system-reminder>`
}
