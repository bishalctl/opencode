export * as Brainstorm from "./brainstorm.js"

// Fork feature (bishal-patches/docs/brainstorm.md). The contract shared by the server plugin
// (packages/core/src/plugin/bishal/brainstorm.ts) and the web, desktop, and TUI clients.

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { Session } from "../session.js"

/** Session metadata key on a brainstorm thread; its value is the main session's ID. */
export const METADATA_KEY = "brainstorm"

/** The read-only agent brainstorm threads run as by default. */
export const AGENT = "brainstorm"

/** The main session a brainstorm thread belongs to, if `info` is one. */
export function mainOf(info: {
  readonly parentID?: Session.ID
  readonly metadata?: Readonly<Record<string, unknown>>
}) {
  const main = info.metadata?.[METADATA_KEY]
  return info.parentID !== undefined && main === info.parentID ? info.parentID : undefined
}

// Standard Schema values keep the definition portable: the renderer's promise client accepts only those.
const Main = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Session.ID }))
const Thread = Schema.toStandardSchemaV1(Schema.Struct({ sessionID: Session.ID }))

export const Definition = Rpc.define({
  id: "bishal.brainstorm",
  methods: {
    /** The main session's one brainstorm thread, created on first use with main's model. */
    ensure: { input: Main, output: Thread },
    /** Replace the thread with a fresh one that keeps its model and agent. */
    clear: { input: Main, output: Thread },
  },
  events: {},
})

type Tokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

type Message = { readonly type: string; readonly tokens?: Tokens }

const total = (tokens: Tokens) =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write

const lastMeasured = (messages: readonly Message[]) =>
  messages.findLast((message) => message.type === "assistant" && !!message.tokens)?.tokens

/**
 * How full the brainstorm's context window is, split into the main session's share and the brainstorm's own.
 * The brainstorm's last reply measured the whole request (main's history + its own conversation); main's share is
 * main's last measured window, capped at that total since main may have grown since. Before the first brainstorm
 * reply only main's share is known.
 */
export function contextShare(input: {
  readonly thread: readonly Message[]
  readonly main: readonly Message[]
  readonly limit?: number
}) {
  const thread = lastMeasured(input.thread)
  const main = lastMeasured(input.main)
  const mainTokens = main ? total(main) : 0
  const measured = thread ? total(thread) : undefined
  const used = measured ?? mainTokens
  const share = {
    main: measured === undefined ? mainTokens : Math.min(mainTokens, measured),
    own: measured === undefined ? 0 : Math.max(0, measured - mainTokens),
    total: used,
    measured: measured !== undefined,
  }
  return {
    ...share,
    percent: input.limit ? Math.min(100, Math.round((used / input.limit) * 100)) : undefined,
  }
}
