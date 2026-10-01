import { describe, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { findExecutable, hostEnvironment, launchCommand, launchDetached } from "./launch"

// Fork fix (bishal-patches/PATCHES.md): apps opened from the desktop get the user's session.

async function tmp() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "desktop-launch-"))
  return { dir, [Symbol.asyncDispose]: () => rm(dir, { recursive: true, force: true }) }
}

async function script(dir: string, name: string, body: string) {
  const file = path.join(dir, name)
  await writeFile(file, `#!/usr/bin/env bash\n${body}\n`)
  await chmod(file, 0o755)
  return file
}

const until = async (check: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await Bun.sleep(50)
  }
  throw new Error("timed out")
}

describe("hostEnvironment", () => {
  test("restores the session's XDG dirs recorded by the launcher and drops desktop internals", () => {
    const env = hostEnvironment({
      PATH: "/bin",
      HOME: "/home/user",
      XDG_CONFIG_HOME: "/home/user/.config/opencode-v2",
      XDG_DATA_HOME: "/home/user/.local/share/opencode-v2",
      XDG_CACHE_HOME: "/home/user/.cache/opencode-v2",
      XDG_STATE_HOME: "/home/user/.local/state/opencode-v2",
      OPENCODE_HOST_ENV: "1",
      OPENCODE_HOST_XDG_CONFIG_HOME: "/home/user/custom-config",
      OPENCODE_HOST_XDG_DATA_HOME: "",
      OPENCODE_HOST_XDG_CACHE_HOME: "",
      OPENCODE_HOST_XDG_STATE_HOME: "",
      OPENCODE_CLIENT: "desktop",
      ELECTRON_RENDERER_URL: "http://localhost:5173",
      CHROME_DESKTOP: "opencode-desktop.desktop",
      BUN_OPTIONS: '--define=OPENCODE_CHANNEL:"bishal"',
      NODE_ENV: "development",
    })
    expect(env).toEqual({ PATH: "/bin", HOME: "/home/user", XDG_CONFIG_HOME: "/home/user/custom-config" })
  })

  test("keeps XDG dirs when no launcher recorded the session's", () => {
    expect(hostEnvironment({ XDG_CONFIG_HOME: "/cfg", OPENCODE_CLIENT: "desktop" })).toEqual({
      XDG_CONFIG_HOME: "/cfg",
    })
  })
})

describe("findExecutable", () => {
  test("finds an app under its Linux aliases on PATH and skips non-executables", async () => {
    await using dir = await tmp()
    const zeditor = await script(dir.dir, "zeditor", "true")
    await writeFile(path.join(dir.dir, "cursor"), "not executable")
    expect(findExecutable("zed", { PATH: dir.dir })).toBe(zeditor)
    expect(findExecutable("cursor", { PATH: dir.dir })).toBeUndefined()
    expect(findExecutable("code", { PATH: dir.dir })).toBeUndefined()
  })
})

describe("launchDetached", () => {
  test("resolves once the app runs, without waiting for it or its inherited pipes", async () => {
    await using dir = await tmp()
    const out = path.join(dir.dir, "env")
    // Keeps running and holds the stdio it was given, like an editor that leaves helpers behind.
    const app = await script(dir.dir, "app", `env > "${out}"; sleep 30 & wait`)
    const started = Date.now()
    await launchDetached(app, [], { PATH: process.env.PATH, XDG_CONFIG_HOME: "/home/user/.config" })
    expect(Date.now() - started).toBeLessThan(2_000)
    await until(async () => (await readFile(out, "utf8").catch(() => "")).includes("XDG_CONFIG_HOME="))
    expect(await readFile(out, "utf8")).toContain("XDG_CONFIG_HOME=/home/user/.config")
  })

  test("rejects when the app cannot start", async () => {
    await expect(launchDetached("/nonexistent/editor", [], { PATH: "" })).rejects.toThrow()
  })
})

describe("launchCommand", () => {
  test("closes inherited descriptors before running the app", async () => {
    await using dir = await tmp()
    const bash = findExecutable("bash")
    if (!bash) return
    const out = path.join(dir.dir, "fds")
    const app = await script(dir.dir, "app", `ls /proc/self/fd > "${out}"`)
    const command = launchCommand(app, [], [65], bash)
    // The outer bash leaves fd 65 open without close-on-exec, the way Electron holds Chromium's descriptors.
    const child = Bun.spawn([bash, "-c", 'exec 65</dev/null; exec "$@"', "outer", command.file, ...command.args])
    expect(await child.exited).toBe(0)
    expect((await readFile(out, "utf8")).split("\n")).not.toContain("65")

    const unclosed = path.join(dir.dir, "fds-unclosed")
    const control = await script(dir.dir, "control", `ls /proc/self/fd > "${unclosed}"`)
    const direct = Bun.spawn([bash, "-c", 'exec 65</dev/null; exec "$@"', "outer", control])
    expect(await direct.exited).toBe(0)
    expect((await readFile(unclosed, "utf8")).split("\n")).toContain("65")
  })

  test("runs the app directly when nothing needs closing", () => {
    expect(launchCommand("/usr/bin/code", ["/project"], [], "/bin/bash")).toEqual({
      file: "/usr/bin/code",
      args: ["/project"],
    })
  })
})
