import { fstatSync, readdirSync, readFileSync } from "node:fs"

// Fork fix (bishal-patches/PATCHES.md). Chromium opens some descriptors without O_CLOEXEC: the
// --remote-debugging-port listener, IPC sockets, GPU and cache files, shared memory. On Linux libuv
// does not close them for children, so the detached background service keeps them after the
// desktop exits (the CDP port stays bound, `Address already in use` on relaunch). Everything above
// stderr that lacks O_CLOEXEC is inherited by the next spawn; the service closes its copies at
// startup (packages/cli/src/inherited-descriptors.ts). Device and inode let the service skip a
// number that was reused before the spawn.
const O_CLOEXEC = 0o2000000

export const INHERITED_DESCRIPTORS_ENV = "OPENCODE_INHERITED_FDS"

export function inheritedDescriptorsEnv(): Record<string, string> {
  const descriptors = inheritedDescriptors().map((item) => `${item.fd}:${item.dev}:${item.ino}`)
  return descriptors.length ? { [INHERITED_DESCRIPTORS_ENV]: descriptors.join(",") } : {}
}

/** This process's descriptors above stderr that the next spawned child inherits (Linux only). */
export function inheritedDescriptors() {
  if (process.platform !== "linux") return []
  return readdirSync("/proc/self/fd")
    .map(Number)
    .filter((fd) => fd > 2)
    .flatMap((fd) => {
      // A descriptor can close between listing and inspection (the listing's own one always does).
      try {
        const flags = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8").match(/^flags:\s*([0-7]+)/m)?.[1]
        if (flags === undefined || Number.parseInt(flags, 8) & O_CLOEXEC) return []
        const stat = fstatSync(fd)
        return [{ fd, dev: stat.dev, ino: stat.ino }]
      } catch {
        return []
      }
    })
}
