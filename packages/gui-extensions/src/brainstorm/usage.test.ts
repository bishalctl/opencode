import { expect, test } from "bun:test"
import { contextShare } from "./usage"

const assistant = (input: number, output = 0) => ({
  type: "assistant",
  tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
})
const user = { type: "user" }

test("before the first brainstorm reply only main's share is known", () => {
  expect(contextShare({ thread: [user], main: [user, assistant(30_000, 1_000)], limit: 200_000 })).toEqual({
    main: 31_000,
    own: 0,
    total: 31_000,
    measured: false,
    percent: 16,
  })
})

test("splits the brainstorm's measured window into main's share and its own", () => {
  expect(
    contextShare({ thread: [user, assistant(40_000, 2_000)], main: [user, assistant(30_000, 1_000)], limit: 100_000 }),
  ).toEqual({ main: 31_000, own: 11_000, total: 42_000, measured: true, percent: 42 })
})

test("caps main's share when main grew after the brainstorm's last reply", () => {
  const share = contextShare({ thread: [assistant(20_000)], main: [assistant(50_000)], limit: 100_000 })
  expect(share).toMatchObject({ main: 20_000, own: 0, total: 20_000 })
})

test("uses the latest measured assistant and omits the percentage without a limit", () => {
  const share = contextShare({ thread: [assistant(10_000), user, { type: "assistant" }], main: [] })
  expect(share).toEqual({ main: 0, own: 10_000, total: 10_000, measured: true, percent: undefined })
})
