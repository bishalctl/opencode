// Fork feature (bishal-patches/docs/brainstorm.md).
import { lazy, Show, Suspense } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import {
  App,
  Command,
  Layout,
  onIdle,
  Panel,
  Sessions,
  Slot,
  type PanelTab,
  type SessionView,
  type Setup,
} from "../sdk"
import { createThreads, serverThreads } from "./threads"

const setup: Setup = (ctx) => {
  const BrainstormPanel = lazy(() => import("./panel"))
  ctx.cleanup(onIdle(() => void BrainstormPanel.preload()))
  const layout = ctx.use(Layout)
  const sessions = ctx.use(Sessions)
  const app = ctx.use(App)
  const threads = createThreads(serverThreads())
  const key = `${ctx.id}:main`
  const tab: PanelTab = {
    id: "main",
    get title() {
      return ctx.t("tab.title")
    },
    label: () => (
      <div class="flex items-center gap-1.5">
        <Icon name="speech-bubble" size="small" />
        <span>{ctx.t("tab.title")}</span>
      </div>
    ),
  }

  const open = (session: SessionView, text?: string) => {
    layout.open(key, session, { focus: true, select: true })
    if (!text) return
    void threads
      .ensure(session)
      .then((sessionID) => session.server.data.session.prompt({ sessionID, text }))
      .catch(() => showToast({ title: ctx.t("send.failed") }))
  }

  ctx.add(
    Command,
    (): Command => ({
      id: "open",
      title: ctx.t("command.title"),
      description: ctx.t("command.description"),
      group: ctx.t("command.category.session"),
      section: "session",
      bind: "mod+alt+b",
      slash: { name: "brainstorm", arguments: true },
      // A brainstorm belongs to a started session, in a desktop-width window.
      enabled: !layout.narrow() && !!sessions.current()?.id,
      run: (input) => {
        const session = sessions.current()
        if (session?.id) open(session, input?.trim() || undefined)
      },
    }),
  )

  ctx.add(Slot, {
    at: "session.header",
    order: 30,
    render: (input) => {
      const keybind = () => [...app.keybind(`${ctx.id}.open`)]
      return (
        <Show when={input.session.id && !layout.narrow()}>
          <Tooltip
            placement="bottom"
            value={
              <>
                {ctx.t("tooltip")}
                <Show when={keybind().length > 0}>
                  <Keybind keys={keybind()} variant="neutral" />
                </Show>
              </>
            }
          >
            <IconButton
              type="button"
              variant="ghost-muted"
              size="large"
              icon={<Icon name="speech-bubble" />}
              aria-label={ctx.t("tooltip")}
              aria-pressed={layout.state(key, input.session) !== "closed"}
              data-action="brainstorm-toggle"
              onClick={() => layout.toggle(key, input.session)}
            />
          </Tooltip>
        </Show>
      )
    },
  })

  ctx.add(Panel, {
    id: "main",
    region: "side",
    // The thread is a durable session, so the tab is restored with the layout like any other.
    list: (_session, open) => (open.includes("main") ? [tab] : []),
    render: (_tab, session) => (
      <Suspense>
        <BrainstormPanel threads={threads} session={session} />
      </Suspense>
    ),
  })
}

export default setup
