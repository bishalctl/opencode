import { createEffect } from "solid-js"
import { Composer } from "@/composer/composer"
import { setCursorPosition } from "@/composer/editor/dom"
import { createComposerModel } from "@/composer/model"
import { ComposerPersistenceProvider, useComposerState } from "@/composer/persistence"
import { createComposerControls } from "@/composer/selection"
import { LocalProvider, useLocal } from "@/providers/models/selection"
import { useData } from "@/runtime/server/current"
import { createActiveComposerAdapter } from "@/session/composer/adapter"
import { createSessionQueue } from "@/session/composer/queue"
import { SessionQueuePanel } from "@/session/composer/queue-panel"
import { resolveSessionComposerSelection } from "@/session/composer/selection"
import { syncPromptModel } from "@/session/session-model-helpers"
import { useSettings } from "@/settings/model"

/**
 * The app's composer bound to `sessionID` instead of the routed session, for `SessionView.SessionComposer`: its own
 * draft, agent and model selection, and queue. Client slash commands are left out because they act on the routed
 * session; server commands submit to `sessionID`.
 */
export function ExtensionSessionComposer(props: { readonly sessionID: string }) {
  return (
    <LocalProvider sessionID={props.sessionID}>
      <ComposerPersistenceProvider sessionID={props.sessionID}>
        <ScopedComposer sessionID={props.sessionID} />
      </ComposerPersistenceProvider>
    </LocalProvider>
  )
}

function ScopedComposer(props: { readonly sessionID: string }) {
  const local = useLocal()
  const prompt = useComposerState()
  const data = useData()
  const settings = useSettings()
  const controls = createComposerControls()
  let editor: HTMLDivElement | undefined

  // Same as the routed composer: durable session state seeds the selection, and the draft mirrors it for submission.
  createEffect(() => {
    const info = data.session.get(props.sessionID)
    const selection = resolveSessionComposerSelection(info, undefined)
    if (info && selection.agent && selection.model)
      local.session.restore({ sessionID: info.id, agent: selection.agent, model: selection.model })
  })
  createEffect(() => {
    if (!prompt.ready() || !local.session.ready()) return
    syncPromptModel(local, prompt)
  })

  const adapter = createActiveComposerAdapter({
    sessionID: props.sessionID,
    controls,
    submitted: () => undefined,
    setEditor: (element) => {
      editor = element
    },
  })
  const queue = createSessionQueue({
    sessionID: props.sessionID,
    draft: adapter.state,
    working: adapter.working,
    behavior: settings.general.followUpBehavior,
    restoreFocus: (cursor) => {
      const target = editor
      if (!target) return
      requestAnimationFrame(() => {
        target.focus()
        setCursorPosition(target, cursor)
      })
    },
  })
  const composer = createComposerModel(adapter, { queue, builtins: false })

  return (
    <div class="relative" data-component="extension-session-composer">
      <SessionQueuePanel queue={queue} />
      <div class="relative z-10">
        <Composer model={composer} borderUnderlay readOnly={queue.undoing()} />
      </div>
    </div>
  )
}
