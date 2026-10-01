import { closeSync, fstatSync } from "node:fs"

// Fork fix (bishal-patches/PATCHES.md). The desktop lists the descriptors this process inherited
// from Electron without O_CLOEXEC (packages/desktop/src/main/service/inherited-descriptors.ts) as
// `fd:dev:ino,...`. Close each one still pointing at the same file, so a long-lived service does
// not keep the desktop's CDP listener, sockets, and cache files open after the desktop exits.
export function closeInheritedDescriptors() {
  const list = process.env.OPENCODE_INHERITED_FDS
  // Not for grandchildren: their descriptor table is their own.
  delete process.env.OPENCODE_INHERITED_FDS
  if (!list) return
  list.split(",").forEach((entry) => {
    const [fd, dev, ino] = entry.split(":").map(Number)
    if (fd === undefined || fd <= 2) return
    // The descriptor may already be gone.
    try {
      const stat = fstatSync(fd)
      if (stat.dev === dev && stat.ino === ino) closeSync(fd)
    } catch {}
  })
}
