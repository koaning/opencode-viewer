import { Command, MenuItem, Panel, Style, type MountedSession, type PanelTab, type Plugin, type SessionRef } from "@opencode/plugin/gui"
import { Schema } from "effect"
import type { definition } from "./definition"
import css from "./style.css?inline"
import { Dashboard } from "./view/dashboard"

const PANEL = "dashboard"

export const setup: Plugin.Setup<typeof definition> = (ctx) => {
  const key = `${ctx.id}:${PANEL}`
  const current = () => ctx.sessions.current()

  ctx.add(Style, css)

  // The model whose prices stand in for models without one, as `provider/model`; "" for none. One value for the app.
  const pricing = ctx.storage.store("pricing", {
    schema: Schema.Struct({ fallback: Schema.String, name: Schema.String }),
    initial: { fallback: "", name: "" },
  })
  const fallback = () => pricing.value?.fallback ?? ""
  const fallbackName = () => (pricing.value?.fallback ? pricing.value.name : undefined)

  const chooseFallback = async (session: MountedSession | undefined = current()) => {
    if (!session) {
      ctx.toast.show({ title: ctx.t("nosession") })
      return
    }
    const data = session.server.data
    if (!data.location.model.list(session.location)) await data.location.model.sync(session.location).catch(() => undefined)
    const models = (data.location.model.list(session.location) ?? []).filter((model) =>
      model.cost.some((c) => c.input > 0 || c.output > 0),
    )
    const choice = await ctx.dialogs.select<{ key: string; name: string }>({
      title: ctx.t("fallback.title"),
      placeholder: ctx.t("fallback.placeholder"),
      current: undefined,
      options: [
        { title: ctx.t("fallback.none"), value: { key: "", name: "" } },
        ...models
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((model) => {
            const base = model.cost.find((c) => !c.tier) ?? model.cost[0]!
            return {
              title: model.name,
              description: `${model.providerID} · $${base.input}/M in · $${base.output}/M out`,
              value: { key: `${model.providerID}/${model.id}`, name: model.name },
              group: ctx.t("fallback.group"),
            }
          }),
      ],
    })
    if (choice) pricing.set({ fallback: choice.key, name: choice.name })
  }

  // One tab object for as long as the plugin runs, so the host doesn't render its label again on a session switch.
  const tab: PanelTab = { id: PANEL, title: ctx.t("panel.title") }

  ctx.add(Panel, {
    id: PANEL,
    region: "side",
    list: (input) => (input.open.includes(PANEL) ? [tab] : []),
    // The render stays mounted across session switches: Dashboard reads `props.session` where it uses it.
    render: (props) => (
      <Dashboard
        session={props.session}
        fallback={fallback}
        fallbackName={fallbackName}
        chooseFallback={() => void chooseFallback(props.session)}
        mode={() => ctx.appearance.mode()}
      />
    ),
  })

  const open = (session: SessionRef | undefined) => {
    if (!session) {
      ctx.toast.show({ title: ctx.t("nosession") })
      return
    }
    ctx.layout.open(key, session, { tab: "select" })
  }

  ctx.add(MenuItem, (): MenuItem => {
    const session = current()
    return {
      menu: "session.panel",
      id: PANEL,
      title: ctx.t("menu.title"),
      description: ctx.t("menu.description"),
      icon: "window-analytics",
      opened: !!session && ctx.layout.state(key, session) !== "closed",
      run: () => open(current()),
    }
  })

  ctx.add(Command, (): Command => ({
    id: "toggle",
    title: ctx.t("command.toggle"),
    keywords: "dashboard tokens context cost time turns usage stats",
    section: "session",
    bind: "mod+shift+d",
    slash: { name: "dashboard" },
    enabled: !!current(),
    run: () => {
      const session = current()
      if (!session) return
      if (ctx.layout.state(key, session) === "visible") ctx.layout.toggle(key, session)
      else open(session)
    },
  }))

  ctx.add(Command, (): Command => ({
    id: "fallback",
    title: ctx.t("command.fallback"),
    keywords: "dashboard price cost estimate model",
    enabled: !!current(),
    run: () => void chooseFallback(),
  }))
}
