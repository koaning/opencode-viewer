import type { ModelCost, ModelInfo, ModelRef, SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { MountedSession } from "@opencode/plugin/gui"
import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import {
  childrenOf,
  contextBreakdown,
  contextTimeline,
  toolStats,
  totalsOf,
  turnsOf,
  withChildren,
  type Breakdown,
  type Step,
  type Timeline,
  type Pricing,
  type ToolStat,
  type Totals,
  type Turn,
} from "./model"
import type { PriceLookup } from "./pricing"

type Data = MountedSession["server"]["data"]

/** One session's numbers, and its subagents' by session id. */
export interface SessionView {
  readonly id: string
  readonly title: string
  readonly agent?: string
  readonly running: boolean
  readonly turns: readonly Turn[]
  /** This session alone. */
  readonly own: Totals
  /** With every subagent's tokens and cost added. */
  readonly totals: Totals
  readonly children: readonly SessionView[]
}

export interface Dashboard {
  readonly root: SessionView | undefined
  /** Subagent sessions by id, for expanding a `task` call in place. */
  readonly sessions: ReadonlyMap<string, SessionView>
  readonly breakdown: Breakdown | undefined
  /** Every request of the session (not its subagents): what its context held and what it produced. */
  readonly timeline: Timeline
  /** Every step of the session and its subagents by id, with the turn it belongs to. */
  readonly steps: ReadonlyMap<string, { readonly step: Step; readonly turn: Turn; readonly session: string }>
  readonly tools: readonly ToolStat[]
  /** The context window of the model the latest request went to. */
  readonly limit: number | undefined
  readonly model: ModelInfo | undefined
  readonly loading: boolean
}

const MAX_DEPTH = 4

const sameModel = (info: ModelInfo, ref: ModelRef) =>
  info.providerID === ref.providerID && (info.id === ref.id || info.modelID === ref.id)

const quiet = (promise: Promise<unknown> | undefined) => void promise?.catch(() => undefined)

/**
 * Follows a mounted session's data: its messages (all of them, not only the window the timeline loaded), its
 * subagents', and the model catalog for limits and prices. `visible` pauses the clock while the tab is hidden.
 */
export function createDashboard(input: {
  readonly session: Accessor<MountedSession>
  readonly visible: Accessor<boolean>
  /** The `provider/model` key of the model whose prices stand in for unpriced ones; "" for none. */
  readonly fallback: Accessor<string>
}): Accessor<Dashboard> {
  const data = (): Data => input.session().server.data
  const [loading, setLoading] = createSignal(false)

  // Load a session's whole history once per session (and again when the server's data object changes).
  const loaded = new WeakMap<Data, Set<string>>()
  const load = (store: Data, id: string) => {
    const seen = loaded.get(store) ?? new Set<string>()
    loaded.set(store, seen)
    if (seen.has(id)) return
    seen.add(id)
    setLoading(true)
    void (async () => {
      try {
        await store.session.message.sync(id)
        // `more` asks for older pages; `all` takes every one of them in one go.
        if (store.session.message.more(id)) await store.session.message.loadMore(id, { all: true })
      } catch (error) {
        seen.delete(id)
        console.warn("[opencode-viewer] could not load messages", { id, error: String(error) })
      } finally {
        setLoading(false)
      }
    })()
  }

  // A child's title and agent come from its session info, which the window may not have yet.
  const info = (store: Data, id: string): SessionInfo | undefined => {
    try {
      if (store.session.missing(id)) return undefined
      return store.session.get(id) ?? undefined
    } catch {
      return undefined
    }
  }
  const infoRequested = new Set<string>()
  const requestInfo = (store: Data, id: string) => {
    if (infoRequested.has(id)) return
    infoRequested.add(id)
    quiet(store.session.sync(id))
  }

  const status = (store: Data, id: string) => {
    try {
      return store.session.status(id)
    } catch {
      return "idle"
    }
  }

  const location = () => input.session().location
  const models = createMemo(() => {
    const store = data()
    const ref = location()
    return store.location.model.list(ref) ?? []
  })
  createEffect(
    on(
      () => [data(), location()] as const,
      ([store, ref]) => {
        if (!store.location.model.list(ref)) quiet(store.location.model.sync(ref))
      },
    ),
  )

  const lookup: PriceLookup = (ref) => models().find((m) => sameModel(m, ref))?.cost
  const fallback = createMemo((): readonly ModelCost[] | undefined => {
    const key = input.fallback()
    if (!key) return undefined
    return models().find((m) => `${m.providerID}/${m.id}` === key)?.cost
  })
  const pricing = createMemo((): Pricing => ({ lookup, fallback: fallback() }))

  // A clock for steps that are still going: ticks only while something runs and the tab shows.
  const [now, setNow] = createSignal(Date.now())
  const anyRunning = createMemo(() => {
    const store = data()
    const root = input.session().id
    return status(store, root) === "running" || store.session.family(root).some((id) => status(store, id) === "running")
  })
  createEffect(() => {
    if (!anyRunning() || !input.visible()) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const messagesOf = (store: Data, id: string): readonly SessionMessageInfo[] => {
    try {
      return store.session.message.list(id) ?? []
    } catch {
      return []
    }
  }

  const build = (store: Data, id: string, depth: number, sessions: Map<string, SessionView>): SessionView => {
    const running = status(store, id) === "running"
    const turns = turnsOf(messagesOf(store, id), { now: running ? now() : Date.now(), running, pricing: pricing() })
    const own = totalsOf(turns)
    const children: SessionView[] = []
    if (depth < MAX_DEPTH)
      for (const child of childrenOf(turns)) {
        if (sessions.has(child)) continue
        const view = build(store, child, depth + 1, sessions)
        children.push(view)
      }
    const meta = info(store, id)
    const view: SessionView = {
      id,
      title: meta?.title ?? "",
      agent: meta?.agent,
      running,
      turns,
      own,
      totals: withChildren(own, children.map((c) => c.totals)),
      children,
    }
    sessions.set(id, view)
    return view
  }

  const dashboard = createMemo((): Dashboard => {
    const store = data()
    const id = input.session().id
    const sessions = new Map<string, SessionView>()
    const root = build(store, id, 0, sessions)
    const messages = messagesOf(store, id)
    const timeline = contextTimeline(messages)
    const breakdown = contextBreakdown(messages, timeline)
    const steps = new Map<string, { step: Step; turn: Turn; session: string }>()
    for (const view of sessions.values())
      for (const turn of view.turns) for (const step of turn.steps) steps.set(step.id, { step, turn, session: view.id })
    const model = breakdown?.model && models().find((m) => sameModel(m, breakdown.model!))
    return {
      root,
      sessions,
      breakdown,
      timeline,
      steps,
      // Subagents' calls count too; their time also sits inside the parent's `task` row.
      tools: toolStats([...sessions.values()].flatMap((view) => view.turns)),
      limit: model?.limit.context,
      model,
      loading: loading() || store.session.message.loading(id),
    }
  })

  // Every session on screen gets its whole history, and subagents their titles.
  createEffect(() => {
    const store = data()
    const root = input.session().id
    for (const id of dashboard().sessions.keys()) {
      load(store, id)
      if (id !== root && !info(store, id)) requestInfo(store, id)
    }
  })

  return dashboard
}
