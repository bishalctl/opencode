import { spawn } from "node:child_process"
import { accessSync, constants } from "node:fs"
import path from "node:path"
import { inheritedDescriptors } from "../service/inherited-descriptors"

// Fork fix (bishal-patches/PATCHES.md). Opening a path in another app (an editor, the file manager)
// must hand that app the user's own session: not the desktop's isolated profile or internals, not its
// Chromium descriptors, and without waiting for the app to exit.

const XDG = ["CONFIG", "DATA", "CACHE", "STATE"] as const

/**
 * The environment for apps the user opens. A launcher that isolates the desktop's profile through
 * XDG_*_HOME (bishal-patches/bin/env.sh) records the session's values as OPENCODE_HOST_XDG_*_HOME
 * with OPENCODE_HOST_ENV=1; those are restored (unset ones removed) so editors use their real
 * profiles and the user's default apps. Desktop-internal variables are dropped either way.
 */
export function hostEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (internal(key)) continue
    next[key] = value
  }
  if (env.OPENCODE_HOST_ENV !== "1") return next
  for (const name of XDG) {
    const host = env[`OPENCODE_HOST_XDG_${name}_HOME`]
    if (host) next[`XDG_${name}_HOME`] = host
    else delete next[`XDG_${name}_HOME`]
  }
  return next
}

// CHROME_DESKTOP would make a launched Chromium-based app (VS Code, Cursor) group under this app's icon.
function internal(key: string) {
  return (
    key.startsWith("OPENCODE_") ||
    key.startsWith("ELECTRON_") ||
    key.startsWith("CHROME_") ||
    key === "BUN_OPTIONS" ||
    key === "NODE_ENV" ||
    key === "NODE_ENV_ELECTRON_VITE" ||
    key === "NODE_OPTIONS"
  )
}

/** Commands an app is installed as on Linux, in preference order; NixOS installs Zed as `zeditor`. */
const LINUX_ALIASES: Record<string, readonly string[]> = {
  zed: ["zed", "zeditor", "zedit"],
  "Sublime Text": ["subl", "sublime_text"],
}

/** The executable that opens `app`, searched on PATH (Linux names may differ by distribution). */
export function findExecutable(app: string, env: NodeJS.ProcessEnv = process.env) {
  const candidates = LINUX_ALIASES[app] ?? [app]
  if (candidates.some((name) => name.includes(path.sep))) return candidates.find(executable)
  const dirs = (env.PATH ?? "").split(path.delimiter).filter(Boolean)
  return candidates.flatMap((name) => dirs.map((dir) => path.join(dir, name))).find(executable)
}

function executable(file: string) {
  try {
    accessSync(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Starts `file` detached from the desktop and resolves once it is running; it rejects only when the
 * process cannot start. Waiting for exit (and for its inherited stdio pipes to close) would hold the
 * caller until the user quit the app, or forever when the app leaves helpers running.
 */
export function launchDetached(file: string, args: readonly string[], env: NodeJS.ProcessEnv = hostEnvironment()) {
  const close = inheritedDescriptors().map((item) => item.fd)
  const command = launchCommand(file, args, close, close.length ? findExecutable("bash", env) : undefined)
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command.file, command.args, { detached: true, stdio: "ignore", env })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}

/** Runs `file` directly, or through `bash` closing the `close` descriptors first (multi-digit fds rule out POSIX sh). */
export function launchCommand(file: string, args: readonly string[], close: readonly number[], bash?: string) {
  if (!bash || close.length === 0) return { file, args: [...args] }
  return {
    file: bash,
    args: ["-c", 'for fd in $0; do eval "exec $fd>&-"; done; exec "$@"', close.join(" "), file, ...args],
  }
}
