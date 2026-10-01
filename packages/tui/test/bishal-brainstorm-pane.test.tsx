// Fork feature (bishal-patches/docs/brainstorm.md): the /brainstorm side pane in the TUI.
import { expect, test } from "bun:test"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

const location = { directory, project: { id: "project", directory, canonical: directory } }
const model = { providerID: "demo", id: "first" }
const base = {
  projectID: "project",
  model,
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const main = { ...base, id: "ses_brainstorm_main", title: "Brainstorm main session", agent: "build" }
const thread = {
  ...base,
  id: "ses_brainstorm_thread",
  title: "Brainstorm",
  parentID: main.id,
  agent: "brainstorm",
  metadata: { brainstorm: main.id },
}
const agent = (id: string, hidden: boolean) => ({ id, mode: "primary", hidden, permissions: [] })

// waitForFrame gives up after a fixed number of render passes, which a loaded machine can exhaust before the
// pane's async thread lookup lands; wait on time instead.
async function frameWith(app: Awaited<ReturnType<typeof createAppFixture>>, check: (frame: string) => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    await app.renderOnce()
    const frame = app.captureCharFrame()
    if (check(frame)) return frame
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for the brainstorm pane frame:\n${app.captureCharFrame()}`)
}

async function setup() {
  const state = await tmpdir()
  const rpc: { method: string; input: unknown }[] = []
  const mutations: { sessionID: string; type: string; body: Record<string, unknown> }[] = []
  const app = await createAppFixture({
    state: state.path,
    width: 140,
    height: 40,
    args: { sessionID: main.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [agent("build", false), agent("brainstorm", true)] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [{ ...model, name: "first model", variants: [], cost: [], time: { released: 0 } }],
        })
      const rpcMethod = url.pathname.match(/^\/api\/rpc\/bishal\.brainstorm\/([^/]+)$/)?.[1]
      if (rpcMethod) {
        rpc.push({ method: rpcMethod, input: ((await request.json()) as { input?: unknown }).input })
        return json({ output: { sessionID: thread.id } })
      }
      if (url.pathname === `/api/session/${main.id}`) return json({ data: main })
      if (url.pathname === `/api/session/${thread.id}`) return json({ data: thread })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      const mutation = url.pathname.match(/^\/api\/session\/([^/]+)\/(agent|model|prompt|command)$/)
      if (!mutation || request.method !== "POST") return
      mutations.push({
        sessionID: mutation[1]!,
        type: mutation[2]!,
        body: (await request.json()) as Record<string, unknown>,
      })
      return new Response(null, { status: 204 })
    },
  })
  await app.ready
  await frameWith(app, (frame) => frame.includes("Build · first model"))
  return {
    app,
    rpc,
    mutations,
    async [Symbol.asyncDispose]() {
      await app[Symbol.asyncDispose]()
      await state[Symbol.asyncDispose]()
    },
  }
}

test("/brainstorm opens the side pane, and its own prompt sends to the thread on its read-only agent", async () => {
  await using fixture = await setup()
  const app = fixture.app

  await app.mockInput.typeText("/brainstorm")
  app.mockInput.pressEscape()
  app.mockInput.pressEnter()
  await frameWith(app, (frame) => frame.includes("Ask anything about what the main session"))
  expect(fixture.rpc).toEqual([{ method: "ensure", input: { sessionID: main.id } }])

  // The pane takes focus on open, so typing goes to the brainstorm's prompt.
  await app.mockInput.typeText("why did main pick sqlite")
  app.mockInput.pressEnter()
  await app.waitFor(() => fixture.mutations.some((item) => item.type === "prompt"))
  const prompts = fixture.mutations.filter((item) => item.type === "prompt")
  expect(prompts).toHaveLength(1)
  expect(prompts[0]).toMatchObject({ sessionID: thread.id, body: { text: "why did main pick sqlite" } })
  // Submitting never swaps the thread's hidden agent, and main is untouched.
  expect(fixture.mutations.filter((item) => item.type === "agent" && item.body.agent !== "brainstorm")).toEqual([])
  expect(fixture.mutations.filter((item) => item.sessionID === main.id)).toEqual([])
})

test("/brainstorm with text sends it to the thread, not the main session", async () => {
  await using fixture = await setup()
  const app = fixture.app

  await app.mockInput.typeText("/brainstorm compare the caching options")
  app.mockInput.pressEscape()
  app.mockInput.pressEnter()
  await app.waitFor(() => fixture.mutations.some((item) => item.type === "prompt"))
  expect(fixture.mutations.filter((item) => item.type === "prompt")).toEqual([
    expect.objectContaining({
      sessionID: thread.id,
      body: expect.objectContaining({ text: "compare the caching options" }),
    }),
  ])
  await frameWith(app, (frame) => frame.includes("Brainstorm") && frame.includes("esc"))
})

test("the pane's prompt leaves out client commands that act on the main session", async () => {
  await using fixture = await setup()
  const app = fixture.app
  const description = "Side chat that sees this session's context"

  // The main prompt lists the client command...
  await app.mockInput.typeText("/brain")
  await frameWith(app, (frame) => frame.includes(description))
  for (const _ of "/brain") app.mockInput.pressBackspace()
  await frameWith(app, (frame) => !frame.includes(description))

  await app.mockInput.typeText("/brainstorm")
  app.mockInput.pressEscape()
  app.mockInput.pressEnter()
  await frameWith(app, (frame) => frame.includes("Ask anything about what the main session"))

  // ...the brainstorm's prompt, which now has focus, does not.
  await app.mockInput.typeText("/brain")
  const frame = await frameWith(app, (value) => value.includes("/brain"))
  expect(frame).not.toContain(description)
})
