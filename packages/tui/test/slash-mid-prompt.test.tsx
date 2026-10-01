import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { directory, json } from "./fixture/tui-client"
import { tmpdir } from "./fixture/fixture"
import { createAppFixture } from "./fixture/app"

// Fork feature (bishal-patches/PATCHES.md): "/" opens the skill and command picker mid-sentence.

async function setupSession() {
  const state = await tmpdir()
  const mutations: { type: string; body: unknown }[] = []
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const session = {
    id: `ses_${crypto.randomUUID()}`,
    projectID: "project",
    title: "Slash mid prompt fixture",
    agent: "build",
    model: { providerID: "demo", id: "first" },
    location: { directory },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 0, updated: 0 },
  }
  const setup = await createAppFixture({
    state: state.path,
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      if (url.pathname === "/api/location") return json(location)
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({
          location,
          data: [
            { id: "first", providerID: "demo", name: "first model", variants: [], cost: [], time: { released: 0 } },
          ],
        })
      if (url.pathname === "/api/command")
        return json({ location, data: [{ name: "review", description: "Review the input" }] })
      if (url.pathname === "/api/skill")
        return json({
          location,
          data: [
            {
              id: "deploy-docs",
              name: "deploy-docs",
              description: "Publish the docs site",
              path: "/skills/deploy-docs/SKILL.md",
              content: "",
            },
          ],
        })
      if (url.pathname === `/api/session/${session.id}`) return json({ data: session })
      if (/^\/api\/session\/[^/]+\/(message|inbox|permission)$/.test(url.pathname))
        return json({ data: [], cursor: {} })
      const type = url.pathname.match(/^\/api\/session\/[^/]+\/(agent|model|command|prompt)$/)?.[1]
      if (!type) return
      mutations.push({ type, body: await request.json() })
      return new Response(null, { status: 204 })
    },
  })
  await setup.ready
  await setup.waitForFrame(
    (frame) =>
      frame.includes("Build · first model") && setup.renderer.currentFocusedRenderable instanceof TextareaRenderable,
  )
  return {
    setup,
    mutations,
    async [Symbol.asyncDispose]() {
      await setup[Symbol.asyncDispose]()
      await state[Symbol.asyncDispose]()
    },
  }
}

test("mid-sentence slash lists skills and server commands, and inserts a skill reference in place", async () => {
  await using fixture = await setupSession()
  const setup = fixture.setup

  await setup.mockInput.typeText("please use /")
  const picker = await setup.waitForFrame((frame) => frame.includes("/deploy-docs") && frame.includes("/review"))
  // Client-only commands make no sense mid-sentence.
  expect(picker).not.toContain("Switch theme")

  await setup.mockInput.typeText("dep")
  await setup.waitForFrame((frame) => !frame.includes("/review"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("please use /deploy-docs") && !frame.includes("Publish the docs"))

  await setup.mockInput.typeText("now")
  setup.mockInput.pressEnter()
  await setup.waitFor(() => fixture.mutations.some((mutation) => mutation.type === "prompt"))
  expect(fixture.mutations.find((mutation) => mutation.type === "prompt")?.body).toMatchObject({
    text: "please use /deploy-docs now",
    skills: [{ id: "deploy-docs", mention: { start: 11, end: 23, text: "/deploy-docs" } }],
  })
})

test("mid-sentence server command moves to the front with the sentence as its arguments", async () => {
  await using fixture = await setupSession()
  const setup = fixture.setup

  await setup.mockInput.typeText("check the diff /rev")
  await setup.waitForFrame((frame) => frame.includes("Review the input"))
  setup.mockInput.pressEnter()
  await setup.waitForFrame((frame) => frame.includes("/review check the diff"))

  setup.mockInput.pressEnter()
  await setup.waitFor(() => fixture.mutations.some((mutation) => mutation.type === "command"))
  expect(fixture.mutations.find((mutation) => mutation.type === "command")?.body).toMatchObject({
    name: "review",
    text: "check the diff",
  })
})

test("skills are listed at the start of the prompt too", async () => {
  await using fixture = await setupSession()
  const setup = fixture.setup

  await setup.mockInput.typeText("/dep")
  await setup.waitForFrame((frame) => frame.includes("/deploy-docs") && frame.includes("skill"))
})

test("a mid-sentence path with no matches hides the picker and submits as typed", async () => {
  await using fixture = await setupSession()
  const setup = fixture.setup

  await setup.mockInput.typeText("read /")
  await setup.waitForFrame((frame) => frame.includes("/deploy-docs"))
  await setup.mockInput.typeText("etc/hosts")
  await setup.waitForFrame((frame) => !frame.includes("/deploy-docs") && frame.includes("read /etc/hosts"))

  setup.mockInput.pressEnter()
  await setup.waitFor(() => fixture.mutations.some((mutation) => mutation.type === "prompt"))
  expect(fixture.mutations.find((mutation) => mutation.type === "prompt")?.body).toMatchObject({
    text: "read /etc/hosts",
  })
})
