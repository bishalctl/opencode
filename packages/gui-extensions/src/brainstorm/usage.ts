// Fork feature (bishal-patches/docs/brainstorm.md).

type Tokens = {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  readonly cache: { readonly read: number; readonly write: number }
}

type Message = { readonly type: string; readonly tokens?: Tokens }

const total = (tokens: Tokens) =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write

const lastMeasured = (messages: readonly Message[]) =>
  messages.findLast((message) => message.type === "assistant" && !!message.tokens)?.tokens

/**
 * How full the brainstorm's context window is, split into the main session's share and the brainstorm's own.
 * The brainstorm's last reply measured the whole request (main's history + its own conversation); main's share is
 * main's last measured window, capped at that total since main may have grown since. Before the first brainstorm
 * reply only main's share is known.
 */
export function contextShare(input: {
  readonly thread: readonly Message[]
  readonly main: readonly Message[]
  readonly limit?: number
}) {
  const thread = lastMeasured(input.thread)
  const main = lastMeasured(input.main)
  const mainTokens = main ? total(main) : 0
  const measured = thread ? total(thread) : undefined
  const used = measured ?? mainTokens
  const share = {
    main: measured === undefined ? mainTokens : Math.min(mainTokens, measured),
    own: measured === undefined ? 0 : Math.max(0, measured - mainTokens),
    total: used,
    measured: measured !== undefined,
  }
  return {
    ...share,
    percent: input.limit ? Math.min(100, Math.round((used / input.limit) * 100)) : undefined,
  }
}
