// Fork feature (bishal-patches/docs/brainstorm.md).
import { createStore } from "solid-js/store"
import { Brainstorm } from "@opencode/schema/bishal/brainstorm"
import type { SessionView } from "../sdk"

type Main = Pick<SessionView, "key" | "id" | "directory" | "server">

export type ThreadApi = {
  readonly ensure: (main: Main) => Promise<string>
  readonly clear: (main: Main) => Promise<string>
}

/** One brainstorm thread per main session, resolved by the server plugin and remembered by this window. */
export function createThreads(api: ThreadApi) {
  const [threads, setThreads] = createStore<Record<string, string>>({})
  const pending = new Map<string, Promise<string>>()
  const remember = (main: Main, id: string) => {
    setThreads(main.key, id)
    return id
  }
  return {
    get: (main: Main) => threads[main.key] as string | undefined,
    ensure: (main: Main) => {
      const known = threads[main.key]
      if (known) return Promise.resolve(known)
      // The panel and a /brainstorm command can both ask before the first answer arrives.
      const inflight = pending.get(main.key)
      if (inflight) return inflight
      const request = api
        .ensure(main)
        .then((id) => remember(main, id))
        .finally(() => pending.delete(main.key))
      pending.set(main.key, request)
      return request
    },
    clear: (main: Main) => api.clear(main).then((id) => remember(main, id)),
  }
}

export type Threads = ReturnType<typeof createThreads>

/** The server plugin's RPC, scoped to the main session's location. */
export function serverThreads(): ThreadApi {
  const call = (main: Main, method: "ensure" | "clear") => {
    if (!main.id) return Promise.reject(new Error("The session has not started yet"))
    return main.server.client
      .rpc(Brainstorm.Definition)
      [method]({ sessionID: main.id }, { location: { directory: main.directory } })
      .then((thread) => thread.sessionID)
  }
  return { ensure: (main) => call(main, "ensure"), clear: (main) => call(main, "clear") }
}
