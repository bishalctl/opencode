import { expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { statSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// Fork fix (bishal-patches/PATCHES.md). Runs under Node like Electron's main process: bun marks
// inherited descriptors close-on-exec at startup, which would hide the leak.
test.skipIf(process.platform !== "linux")("lists descriptors a spawned child would inherit", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "inherited-fds-"))
  try {
    const file = path.join(dir, "leaked")
    await writeFile(file, "x")
    const module = path.join(import.meta.dir, "inherited-descriptors.ts")
    const script = `const { inheritedDescriptorsEnv } = await import(${JSON.stringify(module)}); console.log(JSON.stringify(inheritedDescriptorsEnv()))`
    // bash opens fd 65 without O_CLOEXEC, the way Chromium opens its CDP listener.
    const child = Bun.spawn(
      [
        "bash",
        "-c",
        'exec 65<"$1"; exec node --experimental-strip-types --no-warnings --input-type=module -e "$2"',
        "bash",
        file,
        script,
      ],
      { stdout: "pipe", stderr: "pipe" },
    )
    const output = await new Response(child.stdout).text()
    expect(await child.exited).toBe(0)
    const stat = statSync(file)
    const entries: string[] = JSON.parse(output).OPENCODE_INHERITED_FDS.split(",")
    expect(entries).toContain(`65:${stat.dev}:${stat.ino}`)
    // stdio is replaced by the spawn, and Node's own descriptors are close-on-exec.
    expect(entries.every((entry) => Number(entry.split(":")[0]) > 2)).toBe(true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
