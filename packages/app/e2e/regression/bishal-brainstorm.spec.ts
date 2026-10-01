// Fork feature (bishal-patches/docs/brainstorm.md). The shared harness has no plugin RPC hook or hidden agents, so this
// spec routes those itself instead of editing upstream's utils (keeps fork changes out of shared files).
import { expect, test, type Page } from "@playwright/test"
import { openSession } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

const directory = "C:/OpenCode/Brainstorm"
const main = { id: "ses_brainstorm_main", title: "Brainstorm main session" }
const thread = {
  id: "ses_brainstorm_thread",
  title: "Brainstorm",
  parentID: main.id,
  agent: "brainstorm",
  metadata: { brainstorm: main.id },
}
const agent = (id: string, name: string, hidden: boolean) => ({
  id,
  name,
  mode: "primary",
  hidden,
  request: { settings: {}, headers: {}, body: {} },
  permissions: [],
})

// Registered after the harness: Playwright tries the newest route first, ahead of its unmocked-request guard.
async function routeBrainstorm(page: Page) {
  const calls: { method: string; input: unknown }[] = []
  await page.route("**/api/rpc/bishal.brainstorm/*", async (route) => {
    const method = new URL(route.request().url()).pathname.split("/").at(-1) ?? ""
    calls.push({ method, input: route.request().postDataJSON()?.input })
    await route.fulfill({ json: { output: { sessionID: thread.id } } })
  })
  // The server plugin adds a hidden, read-only agent; the thread runs as it.
  await page.route("**/api/agent?*", (route) =>
    route.fulfill({
      json: {
        location: { directory, project: { id: "proj_brainstorm", directory, canonical: directory } },
        data: [agent("build", "Build", false), agent("brainstorm", "Brainstorm", true)],
      },
    }),
  )
  return calls
}

async function open(page: Page) {
  const prompts: { sessionID: string; body: Record<string, unknown> }[] = []
  const agentSwitches: { sessionID: string; agent: unknown }[] = []
  page.on("request", (request) => {
    const match = new URL(request.url()).pathname.match(/^\/api\/session\/([^/]+)\/agent$/)
    if (request.method() === "POST" && match) agentSwitches.push({ sessionID: match[1]!, agent: request.postDataJSON()?.agent })
  })
  const opened = await openSession(page, {
    name: "Brainstorm",
    sessions: [main, thread],
    // Only the main session is a tab; the brainstorm thread is a hidden child.
    seed: { tabs: [main.id] },
    onPrompt: (input) => prompts.push(input),
  })
  const calls = await routeBrainstorm(page)
  // The app loaded its agent list before these routes existed; restart it so it sees the hidden brainstorm agent.
  await page.reload()
  await expect(opened.editor).toBeEditable()
  const panel = page.locator('[data-slot="brainstorm-panel"]')
  return {
    ...opened,
    calls,
    prompts,
    agentSwitches,
    panel,
    // Two composers render once the panel opens: the main session's dock and the brainstorm's own.
    mainEditor: page.locator('[data-component="session-composer-dock"] [data-component="composer-editor"]'),
    panelEditor: panel.locator('[data-component="composer-editor"]'),
  }
}

test("opens the brainstorm side panel from the session header and sends through the app composer", async ({ page }) => {
  const { calls, prompts, agentSwitches, panel, mainEditor, panelEditor } = await open(page)
  const toggle = page.locator('[data-action="brainstorm-toggle"]')

  await expect(toggle).toBeVisible()
  await expect(panel).toHaveCount(0)
  await toggle.click()
  await expect(panel).toBeVisible()
  await expect(page.getByRole("tab", { name: "Brainstorm" })).toBeVisible()
  await expect(panel.getByText("It never sees this chat.", { exact: false })).toBeVisible()
  expect(calls).toEqual([{ method: "ensure", input: { sessionID: main.id } }])

  // The panel renders the app's own composer, with its model control, bound to the thread.
  await expect(panelEditor).toBeEditable()
  await expect(panel.locator('[data-action="composer-model"]')).toBeVisible()
  await panelEditor.fill("Why did the main session pick SQLite?")
  await panelEditor.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.sessionID).toBe(thread.id)
  expect(prompts[0]?.body).toMatchObject({ text: "Why did the main session pick SQLite?" })
  await expect(panelEditor).toHaveText("")
  // Submitting keeps the thread on its hidden read-only agent, and the main composer is untouched.
  expect(agentSwitches.filter((item) => item.sessionID === thread.id && item.agent !== "brainstorm")).toEqual([])
  expect(agentSwitches.filter((item) => item.sessionID === main.id)).toEqual([])
  await expect(mainEditor).toHaveText("")

  // Closing and reopening shows the same thread without asking the server again.
  await toggle.click()
  await expect(panel).toHaveCount(0)
  await toggle.click()
  await expect(panel).toBeVisible()
  expect(calls).toHaveLength(1)

  // The tab is part of the stored layout and the thread is durable, so a reload restores both.
  await page.reload()
  await expect(panel).toBeVisible()
  await expect(page.getByRole("tab", { name: "Brainstorm" })).toBeVisible()
  await expect.poll(() => calls.length).toBe(2)
  expect(calls[1]).toEqual({ method: "ensure", input: { sessionID: main.id } })
})

test("the brainstorm composer keeps its own draft and leaves out commands that act on the main session", async ({
  page,
}) => {
  const { panel, mainEditor, panelEditor } = await open(page)
  await page.locator('[data-action="brainstorm-toggle"]').click()
  await expect(panelEditor).toBeEditable()

  await mainEditor.fill("main draft")
  await panelEditor.fill("brainstorm draft")
  await expect(mainEditor).toHaveText("main draft")
  await expect(panelEditor).toHaveText("brainstorm draft")

  // Client commands such as /brainstorm itself run against the routed session, so the scoped composer omits them.
  await panelEditor.fill("/brain")
  await expect(panel.locator('[data-suggestion-id="brainstorm.open"]')).toHaveCount(0)
  await mainEditor.fill("/brain")
  await expect(page.locator('[data-suggestion-id="brainstorm.open"]')).toBeVisible()
})

test("/brainstorm with text opens the panel and sends the text to the thread, not the main session", async ({
  page,
}) => {
  const { prompts, editor, panel } = await open(page)

  await editor.fill("/brainstorm compare the two caching options")
  await editor.press("Enter")

  await expect(panel).toBeVisible()
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.sessionID).toBe(thread.id)
  expect(prompts[0]?.body).toMatchObject({ text: "compare the two caching options" })
  expect(prompts.some((prompt) => prompt.sessionID === main.id)).toBe(false)
})
