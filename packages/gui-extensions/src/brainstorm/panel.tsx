// Fork feature (bishal-patches/docs/brainstorm.md).
import { createEffect, createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ProgressCircle } from "@opencode/ui/progress-circle"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import { useI18n } from "@opencode/ui/context/i18n"
import { SessionTimeline } from "@opencode/session-ui/timeline"
import { useExtension, type SessionView } from "../sdk"
import type { Threads } from "./threads"
import { contextShare } from "./usage"

export default function BrainstormPanel(props: { threads: Threads; session: SessionView }) {
  const ctx = useExtension()
  const i18n = useI18n()
  const [state, setState] = createStore({ failed: false })
  const data = () => props.session.server.data
  const client = () => props.session.server.client
  const location = () => ({ directory: props.session.directory })
  const thread = () => props.threads.get(props.session)

  const resolve = () => {
    setState("failed", false)
    props.threads.ensure(props.session).catch(() => setState("failed", true))
  }
  createEffect(() => {
    if (props.session.id && props.session.server.connected) resolve()
  })
  createEffect(() => {
    const id = thread()
    if (!id) return
    void data()
      .session.sync(id)
      .catch(() => undefined)
    void data()
      .session.message.sync(id)
      .catch(() => undefined)
  })
  createEffect(() => {
    if (!props.session.server.connected) return
    const ref = location()
    void Promise.all([
      data().location.provider.sync(ref),
      data().location.model.sync(ref),
      data().location.agent.sync(ref),
    ]).catch(() => undefined)
  })

  const info = () => (thread() ? data().session.get(thread()!) : undefined)
  const messages = () => (thread() ? data().session.message.list(thread()!) : [])
  const busy = () => (thread() ? data().session.status(thread()!) === "running" : false)

  const models = createMemo(() =>
    (data().location.model.list(location()) ?? []).filter((model) => model.status !== "deprecated"),
  )
  const model = createMemo(() => {
    const current = info()?.model
    return models().find((item) => item.providerID === current?.providerID && item.id === current?.id)
  })
  const share = createMemo(() =>
    contextShare({
      thread: messages(),
      main: props.session.id ? data().session.message.list(props.session.id) : [],
      limit: model()?.limit.context,
    }),
  )
  const count = (value: number) => value.toLocaleString(i18n.locale())

  const act = (action: () => Promise<unknown> | undefined) => {
    void Promise.resolve(action()).catch(() => showToast({ title: ctx.t("action.failed") }))
  }
  const compact = () => act(() => (thread() ? client().session.compact({ sessionID: thread()! }) : undefined))
  const clear = () => {
    if (!window.confirm(ctx.t("clear.confirm"))) return
    act(() => props.threads.clear(props.session))
  }
  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="brainstorm-panel">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-v2-border-border-base px-4 py-2">
        <Tooltip
          placement="bottom"
          value={
            <div class="flex w-[200px] flex-col gap-1.5">
              <div class="flex justify-between gap-4">
                <span class="text-v2-text-text-muted">{ctx.t("context.main")}</span>
                <span>{count(share().main)}</span>
              </div>
              <div class="flex justify-between gap-4">
                <span class="text-v2-text-text-muted">{ctx.t("context.own")}</span>
                <span>{count(share().own)}</span>
              </div>
              <Show when={!share().measured}>
                <div class="text-v2-text-text-muted">{ctx.t("context.estimated")}</div>
              </Show>
            </div>
          }
        >
          <div class="flex items-center gap-2 text-12-regular text-v2-text-text-muted" data-slot="brainstorm-context">
            <ProgressCircle appearance="compact" percentage={share().percent ?? 0} />
            <span>
              {ctx.t("context.title")} {share().percent ?? 0}% · {count(share().main)} + {count(share().own)}
            </span>
          </div>
        </Tooltip>
        <div class="flex items-center gap-1">
          <Tooltip value={ctx.t("compact")} placement="bottom">
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="collapse" />}
              aria-label={ctx.t("compact")}
              disabled={!thread() || busy()}
              onClick={compact}
            />
          </Tooltip>
          <Tooltip value={ctx.t("clear")} placement="bottom">
            <IconButton
              size="small"
              variant="ghost-muted"
              icon={<Icon name="outline-trash" />}
              aria-label={ctx.t("clear")}
              disabled={!thread() || busy()}
              onClick={clear}
            />
          </Tooltip>
        </div>
      </div>

      <div class="relative min-h-0 flex-1">
        <Switch>
          <Match when={state.failed}>
            <div class="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
              <div class="text-13-regular text-text-weak">{ctx.t("error")}</div>
              <Button size="small" variant="outline" onClick={resolve}>
                {ctx.t("retry")}
              </Button>
            </div>
          </Match>
          <Match when={thread() && messages().length === 0}>
            <div class="flex h-full items-center justify-center px-8 text-center text-13-regular text-text-weak">
              {ctx.t("empty")}
            </div>
          </Match>
          <Match when={thread()}>
            <ScrollView class="absolute inset-0">
              <div class="px-4 py-3 pb-6">
                <SessionTimeline
                  document={{
                    sessionID: thread()!,
                    messages: messages(),
                    status: busy() ? { type: "busy" } : { type: "idle" },
                    diffs: [],
                  }}
                />
              </div>
            </ScrollView>
          </Match>
        </Switch>
      </div>

      {/* The app's own composer, bound to the thread: model, effort, agent, attachments, mentions, and queue. */}
      <div class="shrink-0 px-3 pb-3" data-slot="brainstorm-composer">
        <Show when={thread()} keyed>
          {(sessionID) => <props.session.SessionComposer sessionID={sessionID} />}
        </Show>
      </div>
    </div>
  )
}
