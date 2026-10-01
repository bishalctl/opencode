import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// Fork fix (bishal-patches/PATCHES.md): the service closes descriptors the desktop listed as inherited.
async function run(entries: (stat: { dev: number; ino: number }) => string) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inherited-fds-"))
  try {
    const file = path.join(dir, "leaked")
    await writeFile(file, "x")
    const stat = statSync(file)
    const module = path.join(import.meta.dir, "..", "src", "inherited-descriptors.ts")
    const script = `
      const { readlinkSync } = require("node:fs")
      const open = () => { try { return readlinkSync("/proc/self/fd/65") } catch { return null } }
      const before = open()
      const { closeInheritedDescriptors } = await import(${JSON.stringify(module)})
      closeInheritedDescriptors()
      console.log(JSON.stringify({ before, after: open(), env: process.env.OPENCODE_INHERITED_FDS ?? null }))
    `
    const child = Bun.spawn(["bash", "-c", 'exec 65<"$1"; exec "$2" -e "$3"', "bash", file, process.execPath, script], {
      env: { ...process.env, OPENCODE_INHERITED_FDS: entries(stat) },
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    return { file, result: JSON.parse(output) as { before: string | null; after: string | null; env: string | null } }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test.skipIf(process.platform !== "linux")("closes a listed inherited descriptor and clears the variable", async () => {
  const { file, result } = await run((stat) => `65:${stat.dev}:${stat.ino}`)
  expect(result.before).toBe(file)
  expect(result.after).toBeNull()
  expect(result.env).toBeNull()
})

test.skipIf(process.platform !== "linux")("keeps a descriptor whose identity no longer matches", async () => {
  const { file, result } = await run((stat) => `65:${stat.dev}:${stat.ino + 1}`)
  expect(result.before).toBe(file)
  expect(result.after).toBe(file)
})
