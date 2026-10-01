import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createThreads } from "./threads"

const main = (key: string) =>
  ({ key, id: `ses_${key}`, directory: "/project" }) as Parameters<ReturnType<typeof createThreads>["ensure"]>[0]

const setup = () => {
  const calls: string[] = []
  let next = 0
  const threads = createRoot(() =>
    createThreads({
      ensure: (session) => {
        calls.push(`ensure:${session.key}`)
        return Promise.resolve(`thread_${session.key}_${next++}`)
      },
      clear: (session) => {
        calls.push(`clear:${session.key}`)
        return Promise.resolve(`thread_${session.key}_${next++}`)
      },
    }),
  )
  return { calls, threads }
}

test("resolves a main session's thread once and remembers it", async () => {
  const { calls, threads } = setup()
  const [first, second] = await Promise.all([threads.ensure(main("a")), threads.ensure(main("a"))])
  expect(first).toBe("thread_a_0")
  expect(second).toBe(first)
  expect(await threads.ensure(main("a"))).toBe(first)
  expect(threads.get(main("a"))).toBe(first)
  expect(calls).toEqual(["ensure:a"])
})

test("keeps threads per main session and replaces one on clear", async () => {
  const { calls, threads } = setup()
  const a = await threads.ensure(main("a"))
  const b = await threads.ensure(main("b"))
  expect(a).not.toBe(b)
  const cleared = await threads.clear(main("a"))
  expect(cleared).not.toBe(a)
  expect(threads.get(main("a"))).toBe(cleared)
  expect(threads.get(main("b"))).toBe(b)
  expect(calls).toEqual(["ensure:a", "ensure:b", "clear:a"])
})

test("a failed lookup is retried on the next ensure", async () => {
  let fail = true
  const threads = createRoot(() =>
    createThreads({
      ensure: () => (fail ? Promise.reject(new Error("offline")) : Promise.resolve("thread")),
      clear: () => Promise.reject(new Error("unused")),
    }),
  )
  await expect(threads.ensure(main("a"))).rejects.toThrow("offline")
  fail = false
  expect(await threads.ensure(main("a"))).toBe("thread")
})
