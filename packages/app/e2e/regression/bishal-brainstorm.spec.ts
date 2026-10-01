// Fork feature (bishal-patches/docs/brainstorm.md). The shared harness has no plugin RPC hook, so this spec routes
// the brainstorm RPC itself instead of editing upstream's utils (keeps fork changes out of shared files).
import { expect, test, type Page } from "@playwright/test"
import { openSession } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

const main = { id: "ses_brainstorm_main", title: "Brainstorm main session" }
const thread = {
  id: "ses_brainstorm_thread",
  title: "Brainstorm",
  parentID: main.id,
  agent: "brainstorm",
  metadata: { brainstorm: main.id },
}

async function routeBrainstorm(page: Page) {
  const calls: { method: string; input: unknown }[] = []
  await page.route("**/api/rpc/bishal.brainstorm/*", async (route) => {
    const method = new URL(route.request().url()).pathname.split("/").at(-1) ?? ""
    calls.push({ method, input: route.request().postDataJSON()?.input })
    await route.fulfill({ json: { output: { sessionID: thread.id } } })
  })
  return calls
}

async function open(page: Page) {
  const prompts: { sessionID: string; body: Record<string, unknown> }[] = []
  const opened = await openSession(page, {
    name: "Brainstorm",
    sessions: [main, thread],
    // Only the main session is a tab; the brainstorm thread is a hidden child.
    seed: { tabs: [main.id] },
    onPrompt: (input) => prompts.push(input),
  })
  // Registered after the harness: Playwright tries the newest route first, ahead of its unmocked-request guard.
  // The panel asks for its thread only once opened, so nothing is missed.
  const calls = await routeBrainstorm(page)
  return { ...opened, calls, prompts }
}

test("opens the brainstorm side panel from the session header and sends into its own thread", async ({ page }) => {
  const { calls, prompts, editor } = await open(page)
  const toggle = page.locator('[data-action="brainstorm-toggle"]')
  const panel = page.locator('[data-slot="brainstorm-panel"]')

  await expect(toggle).toBeVisible()
  await expect(panel).toHaveCount(0)
  await toggle.click()
  await expect(panel).toBeVisible()
  await expect(page.getByRole("tab", { name: "Brainstorm" })).toBeVisible()
  await expect(panel.getByText("It never sees this chat.", { exact: false })).toBeVisible()
  expect(calls).toEqual([{ method: "ensure", input: { sessionID: main.id } }])

  const box = panel.getByPlaceholder("Brainstorm with the main session in view…")
  await box.fill("Why did the main session pick SQLite?")
  await box.press("Enter")
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.sessionID).toBe(thread.id)
  expect(prompts[0]?.body).toMatchObject({ text: "Why did the main session pick SQLite?" })
  await expect(box).toHaveValue("")
  // The main composer is untouched.
  await expect(editor).toHaveText("")

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

test("/brainstorm with text opens the panel and sends the text to the thread, not the main session", async ({
  page,
}) => {
  const { prompts, editor } = await open(page)

  await editor.fill("/brainstorm compare the two caching options")
  await editor.press("Enter")

  await expect(page.locator('[data-slot="brainstorm-panel"]')).toBeVisible()
  await expect.poll(() => prompts.length).toBe(1)
  expect(prompts[0]?.sessionID).toBe(thread.id)
  expect(prompts[0]?.body).toMatchObject({ text: "compare the two caching options" })
  expect(prompts.some((prompt) => prompt.sessionID === main.id)).toBe(false)
})
