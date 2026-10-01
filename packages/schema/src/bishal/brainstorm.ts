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

const Main = Schema.Struct({ sessionID: Session.ID })
const Thread = Schema.Struct({ sessionID: Session.ID })

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
