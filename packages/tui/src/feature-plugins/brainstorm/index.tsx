// Fork feature (bishal-patches/docs/brainstorm.md): the persistent /brainstorm side chat as a TUI side pane.
import { Plugin } from "@opencode/plugin/tui"
import type { Context, PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { Brainstorm } from "@opencode/schema/bishal/brainstorm"
import { createEffect, createMemo, createSignal, For, Match, on, onMount, Show, Switch } from "solid-js"
import { Prompt } from "../../component/prompt"
import { Spinner } from "../../component/spinner"
import { LocalProvider } from "../../context/local"
import { useTheme, useThemes } from "../../context/theme"
import { usePlugin } from "../../plugin/context"
import { SlotRoot } from "../../plugin/render"
import { useToast } from "../../ui/toast"
import { Locale } from "../../util/locale"

const PANEL = "brainstorm"

export default Plugin.define({
  id: "bishal.brainstorm",
  setup(context) {
    const threads = createThreads(context)

    context.ui.slot({
      append: "app",
      render() {
        const toast = useToast()
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "brainstorm.open",
              title: "Brainstorm",
              description: "Side chat that sees this session's context; the session never sees it",
              group: "Session",
              palette: true,
              slash: { name: "brainstorm", arguments: true },
              run(input) {
                const route = context.ui.router.current()
                if (route.type !== "session") {
                  toast.show({ message: "Open a session first", variant: "warning" })
                  return
                }
                context.ui.panel.open(PANEL)
                const text = input?.trim()
                if (!text) return
                void threads
                  .ensure(route.sessionID)
                  .then((sessionID) => context.client.session.prompt({ sessionID, text }))
                  .catch((cause: unknown) => toast.error(cause))
              },
            },
          ],
        }))
        return null
      },
    })

    context.ui.slot({
      append: "session.panel",
      render: (input) => (
        <Show when={input.name === PANEL}>
          <BrainstormPane input={input} context={context} threads={threads} />
        </Show>
      ),
    })
  },
})

/** One brainstorm thread per main session, resolved by the server plugin and remembered by this TUI. */
function createThreads(context: Context) {
  const [threads, setThreads] = createSignal<Record<string, string>>({})
  const pending = new Map<string, Promise<string>>()
  const call = (main: string, method: "ensure" | "clear") => {
    const directory = context.data.session.get(main)?.location?.directory
    return context.client
      .rpc(Brainstorm.Definition)
      [method]({ sessionID: main }, directory ? { location: { directory } } : undefined)
      .then((thread) => {
        setThreads((current) => ({ ...current, [main]: thread.sessionID }))
        return thread.sessionID
      })
  }
  return {
    get: (main: string) => threads()[main],
    ensure: (main: string) => {
      const known = threads()[main]
      if (known) return Promise.resolve(known)
      const inflight = pending.get(main)
      if (inflight) return inflight
      const request = call(main, "ensure").finally(() => pending.delete(main))
      pending.set(main, request)
      return request
    },
    clear: (main: string) => call(main, "clear"),
  }
}

type Threads = ReturnType<typeof createThreads>

function BrainstormPane(props: { input: PanelInput; context: Context; threads: Threads }) {
  const theme = useTheme()
  const syntax = useThemes().currentSyntax
  const plugins = usePlugin()
  const toast = useToast()
  const data = props.context.data
  const [failed, setFailed] = createSignal(false)
  const thread = () => props.threads.get(props.input.sessionID)

  const resolve = () => {
    setFailed(false)
    props.threads.ensure(props.input.sessionID).catch(() => setFailed(true))
  }
  createEffect(on(() => props.input.sessionID, resolve))
  // Opening the brainstorm means typing into it next.
  onMount(() => props.input.focus())
  createEffect(() => {
    const id = thread()
    if (!id) return
    void data.session.sync(id).catch(() => undefined)
    void data.session.message.sync(id).catch(() => undefined)
  })

  const messages = () => (thread() ? data.session.message.list(thread()!) : [])
  const busy = () => (thread() ? data.session.status(thread()!) === "running" : false)
  const share = createMemo(() => {
    const location = data.session.get(props.input.sessionID)?.location
    const model = data.session.get(thread() ?? "")?.model
    const limit = data.location
      .model.list(location)
      ?.find((item) => item.providerID === model?.providerID && item.id === model?.id)?.limit?.context
    return Brainstorm.contextShare({ thread: messages(), main: data.session.message.list(props.input.sessionID), limit })
  })

  const act = (action: () => Promise<unknown> | undefined) => {
    void Promise.resolve(action()).catch((cause: unknown) => toast.error(cause))
  }
  const compact = () => act(() => (thread() ? props.context.client.session.compact({ sessionID: thread()! }) : undefined))
  const clear = () =>
    act(async () => {
      const confirmed = await props.context.ui.dialog.confirm({
        title: "Clear brainstorm",
        message: "Start a fresh brainstorm? This one's messages are deleted.",
        label: { confirm: "Clear" },
      })
      if (confirmed) await props.threads.clear(props.input.sessionID)
    })

  // Pane keys apply only while the pane has focus; the composer keeps typing keys.
  useKeyboard((event) => {
    if (!props.input.focused) return
    if (event.name === "escape") props.input.close()
  })

  return (
    <box flexGrow={1} minHeight={0} flexDirection="column" data-slot="brainstorm-pane">
      <box flexDirection="row" gap={2} paddingLeft={1} paddingRight={1} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={0}>
          Brainstorm
        </text>
        <text fg={theme.text.muted} flexGrow={1} wrapMode="none" truncate>
          {`${share().percent ?? 0}% · main ${Locale.number(share().main)} + ${Locale.number(share().own)}`}
        </text>
        <text fg={theme.text.muted} flexShrink={0} onMouseUp={compact}>
          compact
        </text>
        <text fg={theme.text.muted} flexShrink={0} onMouseUp={clear}>
          clear
        </text>
        <text fg={theme.text.muted} flexShrink={0} onMouseUp={props.input.toggleFullscreen}>
          ⤢
        </text>
        <text fg={theme.text.muted} flexShrink={0} onMouseUp={props.input.close}>
          esc
        </text>
      </box>

      <scrollbox flexGrow={1} minHeight={0} stickyScroll stickyStart="bottom" scrollbarOptions={{ visible: false }}>
        <box paddingLeft={1} paddingRight={1} gap={1}>
          <Switch>
            <Match when={failed()}>
              <text fg={theme.text.feedback.error.base} onMouseUp={resolve}>
                Couldn't open the brainstorm · click to retry
              </text>
            </Match>
            <Match when={thread() && messages().length === 0}>
              <text fg={theme.text.muted}>
                Ask anything about what the main session is doing. It never sees this chat.
              </text>
            </Match>
          </Switch>
          <For each={messages()}>
            {(message) => (
              <Switch>
                <Match when={message.type === "user" && message}>
                  {(user) => (
                    <box border={["left"]} borderColor={theme.border.base} paddingLeft={1}>
                      <text fg={theme.text.base}>{user().text}</text>
                    </box>
                  )}
                </Match>
                <Match when={message.type === "assistant" && message}>
                  {(assistant) => (
                    <box gap={1}>
                      <For each={assistant().content}>
                        {(part) => (
                          <Switch>
                            <Match when={part.type === "text" && part.text.trim() ? part : undefined}>
                              {(text) => (
                                <markdown
                                  syntaxStyle={syntax()}
                                  renderNode={plugins.markdown()}
                                  content={text().text.trim()}
                                  streaming={assistant().time.completed === undefined}
                                  conceal
                                  internalBlockMode="top-level"
                                  tableOptions={{ style: "grid", cellPaddingX: 1 }}
                                  fg={theme.markdown.text}
                                  bg={theme.background.raised.base}
                                />
                              )}
                            </Match>
                            <Match when={part.type === "tool" && part}>
                              {(tool) => <text fg={theme.text.muted}>{`· ${tool().name}`}</text>}
                            </Match>
                          </Switch>
                        )}
                      </For>
                    </box>
                  )}
                </Match>
                <Match when={message.type === "compaction"}>
                  <text fg={theme.text.muted}>— compacted —</text>
                </Match>
              </Switch>
            )}
          </For>
          <Show when={busy()}>
            <Spinner>Thinking</Spinner>
          </Show>
        </box>
      </scrollbox>

      {/* The TUI's own prompt bound to the thread: model, agent, mentions, and queue; client commands stay out. */}
      <box flexShrink={0}>
        <Show when={thread()} keyed>
          {(sessionID) => (
            // The prompt carries its own root slots (footer, status), so it starts a fresh slot tree here.
            <SlotRoot>
              <LocalProvider sessionID={sessionID}>
                <Prompt sessionID={sessionID} builtins={false} />
              </LocalProvider>
            </SlotRoot>
          )}
        </Show>
      </box>
    </box>
  )
}
