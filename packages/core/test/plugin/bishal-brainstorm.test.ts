// Fork feature (bishal-patches/docs/brainstorm.md): brainstorm threads see main's live, settled
// context through the session context hook, and never write into main.
import { expect } from "bun:test"
import { Message } from "@opencode/ai"
import { Agent } from "@opencode/core/agent"
import { Bus } from "@opencode/core/bus"
import { Plugin } from "@opencode/core/plugin"
import { BrainstormPlugin } from "@opencode/core/plugin/bishal/brainstorm"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Session } from "@opencode/core/session"
import { SessionEvent } from "@opencode/core/session/event"
import { SessionMessage } from "@opencode/core/session/message"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Brainstorm } from "@opencode/schema/bishal/brainstorm"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Effect } from "effect"
import { testEffect } from "../lib/effect"
import { PluginTestLayer } from "./fixture"

const it = testEffect(PluginTestLayer)
const model = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("brainstorm-model") })
const tokens = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

const activate = Effect.gen(function* () {
  const host = yield* PluginHost.make(yield* Plugin.Service)
  yield* BrainstormPlugin.Plugin.effect(host)
  const main = yield* host.session.create({ title: "Main" })
  return {
    host,
    main,
    hooks: yield* PluginHooks.Service,
    bus: yield* Bus.Service,
    rpc: (yield* Rpc.Service).client(Brainstorm.Definition),
  }
})

const userTurn = (bus: Bus.Interface, sessionID: Session.ID, text: string) =>
  Effect.gen(function* () {
    const inboxID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.InboxEnqueued, {
      sessionID,
      inboxID,
      item: { type: "user", payload: { text }, delivery: "steer" },
    })
    yield* bus.publish(SessionEvent.InboxDelivered, { sessionID, inboxID })
  })

const assistantTurn = (
  bus: Bus.Interface,
  sessionID: Session.ID,
  text: string,
  options: { finished: boolean; tool?: string } = { finished: true },
) =>
  Effect.gen(function* () {
    const assistantMessageID = SessionMessage.ID.create()
    yield* bus.publish(SessionEvent.Step.Started, {
      sessionID,
      assistantMessageID,
      agent: Agent.ID.make("build"),
      model,
      started: 0,
    })
    yield* bus.publish(SessionEvent.Text.Started, { sessionID, assistantMessageID, ordinal: 0 })
    yield* bus.publish(SessionEvent.Text.Ended, { sessionID, assistantMessageID, ordinal: 0, text })
    if (options.tool) {
      yield* bus.publish(SessionEvent.Tool.Input.Started, {
        sessionID,
        assistantMessageID,
        id: "call",
        name: options.tool,
      })
      yield* bus.publish(SessionEvent.Tool.Input.Ended, { sessionID, assistantMessageID, id: "call", text: "{}" })
      yield* bus.publish(SessionEvent.Tool.Called, {
        sessionID,
        assistantMessageID,
        id: "call",
        input: {},
        executed: false,
      })
    }
    if (options.finished)
      yield* bus.publish(SessionEvent.Step.Ended, {
        sessionID,
        assistantMessageID,
        finish: "stop",
        cost: Money.USD.make(0),
        tokens,
      })
  })

const request = (sessionID: Session.ID, own: Message[] = []): SessionHooks["context"] => ({
  sessionID,
  agent: Agent.ID.make(Brainstorm.AGENT),
  model,
  system: [],
  messages: own,
  tools: {},
  options: {},
})

const texts = (messages: readonly Message[]) =>
  messages.flatMap((message) =>
    message.content.flatMap((part) => (part.type === "text" ? [`${message.role}: ${part.text}`] : [])),
  )

it.live("ensure creates one hidden brainstorm thread per main session", () =>
  Effect.gen(function* () {
    const { host, main, rpc } = yield* activate
    const first = yield* rpc.ensure({ sessionID: main.id })
    const thread = yield* host.session.get({ sessionID: first.sessionID })

    expect(thread.parentID).toBe(main.id)
    expect(Brainstorm.mainOf(thread)).toBe(main.id)
    expect(thread.agent).toBe(Agent.ID.make(Brainstorm.AGENT))
    expect((yield* rpc.ensure({ sessionID: main.id })).sessionID).toBe(first.sessionID)
  }),
)

it.live("prepends main's settled history, re-read on every step, before the brainstorm's own messages", () =>
  Effect.gen(function* () {
    const { main, hooks, bus, rpc } = yield* activate
    const { sessionID } = yield* rpc.ensure({ sessionID: main.id })
    yield* userTurn(bus, main.id, "Main question")
    yield* assistantTurn(bus, main.id, "Main answer")

    const first = request(sessionID, [Message.user("Brainstorm question")])
    yield* hooks.trigger("session", "context", first)
    const lines = texts(first.messages)
    expect(lines.slice(0, 2)).toEqual(["user: Main question", "assistant: Main answer"])
    expect(lines[2]).toContain("separate brainstorm side chat")
    expect(lines.at(-1)).toBe("user: Brainstorm question")

    // Main moves on; the next brainstorm step sees it without any resync.
    yield* userTurn(bus, main.id, "Main follow-up")
    yield* assistantTurn(bus, main.id, "Main second answer")
    const second = request(sessionID)
    yield* hooks.trigger("session", "context", second)
    expect(texts(second.messages).slice(0, 4)).toEqual([
      "user: Main question",
      "assistant: Main answer",
      "user: Main follow-up",
      "assistant: Main second answer",
    ])
  }),
)

it.live("includes only main's settled turns and notes the work still in progress", () =>
  Effect.gen(function* () {
    const { main, hooks, bus, rpc } = yield* activate
    const { sessionID } = yield* rpc.ensure({ sessionID: main.id })
    yield* userTurn(bus, main.id, "Run the tests")
    yield* assistantTurn(bus, main.id, "Partial output", { finished: false, tool: "shell" })

    const event = request(sessionID)
    yield* hooks.trigger("session", "context", event)
    const lines = texts(event.messages)
    expect(lines[0]).toBe("user: Run the tests")
    expect(lines.join("\n")).not.toContain("Partial output")
    expect(lines.at(-1)).toContain("still working on its latest request (running: shell)")
  }),
)

it.live("leaves main and other sessions' requests untouched", () =>
  Effect.gen(function* () {
    const { main, hooks, bus } = yield* activate
    yield* userTurn(bus, main.id, "Main question")
    const event = request(main.id, [Message.user("Main question")])
    yield* hooks.trigger("session", "context", event)
    expect(texts(event.messages)).toEqual(["user: Main question"])
  }),
)

it.live("clear replaces the thread and keeps its model and agent", () =>
  Effect.gen(function* () {
    const { host, main, rpc } = yield* activate
    const previous = yield* rpc.ensure({ sessionID: main.id })
    yield* host.session.switchModel({ sessionID: previous.sessionID, model })

    const next = yield* rpc.clear({ sessionID: main.id })
    expect(next.sessionID).not.toBe(previous.sessionID)
    expect(yield* host.session.get({ sessionID: previous.sessionID }).pipe(Effect.flip)).toMatchObject({
      _tag: "Session.NotFoundError",
    })
    const thread = yield* host.session.get({ sessionID: next.sessionID })
    expect(thread.model).toMatchObject(model)
    expect(thread.agent).toBe(Agent.ID.make(Brainstorm.AGENT))
    expect((yield* rpc.ensure({ sessionID: main.id })).sessionID).toBe(next.sessionID)
  }),
)
