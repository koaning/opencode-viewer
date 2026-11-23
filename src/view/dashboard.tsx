import type { MountedSession } from "@opencode/plugin/gui"
import { usePanel } from "@opencode/plugin/gui"
import { createMemo, createSignal, For, Match, onCleanup, Show, Switch, type Accessor, type JSX } from "solid-js"
import { createDashboard, type Dashboard as Data, type SessionView } from "../data"
import * as f from "../format"
import { contextOf, totalOf, type ToolStat, type Turn } from "../model"
import type { Cost } from "../pricing"
import { grouped, paletteOf, TIME, toolParts, TOOLS, type Family, type Palette } from "./buckets"
import { ContextChart, Legend, StackBar, type Segment } from "./charts"
import { famProps, FocusContext, useFocus, type Focus } from "./focus"
import { tween } from "./motion"
import { createTip, type Tip } from "./tip"
import { TurnTrace } from "./trace"

export interface Props {
  readonly session: MountedSession
  /** The `provider/model` key whose prices stand in for unpriced models; "" for none. */
  readonly fallback: Accessor<string>
  readonly fallbackName: Accessor<string | undefined>
  readonly chooseFallback: () => void
  readonly mode: Accessor<"light" | "dark">
}

export function Dashboard(props: Props) {
  const panel = usePanel()
  const tip = createTip()
  const dashboard = createDashboard({
    session: () => props.session,
    visible: panel.visible,
    fallback: props.fallback,
  })
  const root = () => dashboard().root
  const palette = createMemo(() => {
    const keys = new Set<string>()
    for (const point of dashboard().timeline.points) for (const key of Object.keys(point.parts)) keys.add(key)
    return paletteOf(keys)
  })

  // One series family in focus, from hovering a legend row or a bar segment: see focus.ts.
  const [focused, setFocused] = createSignal<Family>()
  const focus: Focus = { set: setFocused }

  // The turns are an accordion: the latest is open unless you fold it, any other opens when you click it. A new turn
  // takes over as the open one, and the one before it folds unless you opened it yourself.
  const [toggled, setToggled] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const latest = () => root()?.turns[root()!.turns.length - 1]?.id
  const isOpen = (id: string) => toggled().get(id) ?? id === latest()
  const toggle = (id: string) => setToggled((map) => new Map(map).set(id, !isOpen(id)))
  // One picked span (a request, tool call or marker), shared by the chart and every open trace.
  const [span, setSpan] = createSignal<string>()
  let rootEl: HTMLElement | undefined
  const pickStep = (stepId: string) => {
    const hit = dashboard().steps.get(stepId)
    if (!hit) return
    setToggled((map) => new Map(map).set(hit.turn.id, true))
    setSpan(stepId)
    requestAnimationFrame(() =>
      rootEl?.querySelector(`[data-turn="${hit.turn.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
    )
  }

  // Once the summary scrolls under the header, the header carries its headline numbers instead.
  const [stuck, setStuck] = createSignal(false)
  const watchSummary = (el: HTMLElement) => {
    if (typeof IntersectionObserver === "undefined") return
    let observer: IntersectionObserver | undefined
    // On the next frame, once the dashboard is in the page and its styles apply. The root scrolls in Desktop's panel;
    // on a page that lets it grow (the docs), the page scrolls instead.
    const frame = requestAnimationFrame(() => {
      const scrolls = !!rootEl && getComputedStyle(rootEl).overflowY !== "visible"
      observer = new IntersectionObserver(([entry]) => setStuck(!!entry && !entry.isIntersecting), {
        root: scrolls ? rootEl : null,
        rootMargin: "-40px 0px 0px 0px",
      })
      observer.observe(el)
    })
    onCleanup(() => {
      cancelAnimationFrame(frame)
      observer?.disconnect()
    })
  }

  return (
    <FocusContext.Provider value={focus}>
      <div
        class="ocv-root"
        data-mode={props.mode()}
        data-focus={focused()}
        ref={(el) => {
          rootEl = el
          tip.ref(el)
        }}
      >
        <header class="ocv-header" classList={{ "ocv-stuck": stuck() }}>
          <div class="ocv-title">
            <Show when={root()?.running} fallback={<span class="ocv-status" />}>
              <span class="ocv-status ocv-status-live" title="Running" />
            </Show>
            <span class="ocv-title-text">{root()?.title || "Session"}</span>
            <Show when={dashboard().loading}>
              <span class="ocv-muted ocv-small">loading…</span>
            </Show>
          </div>
          <Show
            when={stuck() && root()}
            fallback={
              <button class="ocv-link" onClick={props.chooseFallback} title="Estimate cost for models without a price">
                {props.fallbackName() ? `Unpriced as ${props.fallbackName()}` : "Price unpriced models…"}
              </button>
            }
          >
            {(view) => <Glance data={dashboard()} view={view()} />}
          </Show>
        </header>

        <Show when={root()} fallback={<div class="ocv-empty">Nothing in this session yet.</div>}>
          {(view) => (
            <>
              <section class="ocv-summary" ref={watchSummary}>
                <ContextPanel data={dashboard()} palette={palette()} tip={tip} />
                <Strip data={dashboard()} view={view()} fallbackName={props.fallbackName()} />
              </section>
              <RequestsSection data={dashboard()} view={view()} palette={palette()} tip={tip} selected={span()} onSelect={pickStep} />
              <TurnsSection
                view={view()}
                dashboard={dashboard()}
                palette={palette()}
                tip={tip}
                isOpen={isOpen}
                onToggle={toggle}
                span={span()}
                onSpan={setSpan}
              />
              <ToolsSection tools={dashboard().tools} />
            </>
          )}
        </Show>
        <tip.View />
      </div>
    </FocusContext.Provider>
  )
}

const activeMs = (view: SessionView) => view.turns.reduce((sum, t) => sum + t.ms, 0)

/** The headline numbers on one line, for the header once the summary has scrolled away. */
function Glance(props: { readonly data: Data; readonly view: SessionView }) {
  const total = () => props.data.breakdown?.total ?? 0
  return (
    <div class="ocv-glance ocv-num ocv-fade-in">
      <Show when={props.data.limit}>
        <span title="Context used">{f.share(total(), props.data.limit!)} ctx</span>
      </Show>
      <span title="Cost">{f.cost(props.view.totals.cost)}</span>
      <span title="Active time">{f.duration(activeMs(props.view))}</span>
    </div>
  )
}

function Kpi(props: { readonly label: JSX.Element; readonly value: JSX.Element; readonly title?: string }) {
  return (
    <div class="ocv-kpi" title={props.title}>
      <div class="ocv-kpi-value">{props.value}</div>
      <div class="ocv-kpi-label">{props.label}</div>
    </div>
  )
}

/** The session's other numbers, one line of value-over-label pairs; the detail is in each one's tooltip. */
function Strip(props: { readonly data: Data; readonly view: SessionView; readonly fallbackName?: string }) {
  const totals = () => props.view.totals
  const own = () => props.view.own
  const sent = () => contextOf(totals().usage)
  const cached = () => (sent() > 0 ? totals().usage.cacheRead / sent() : 0)
  const out = () => totals().usage.output + totals().usage.reasoning
  const subagents = () => props.data.sessions.size - 1
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  return (
    <div class="ocv-kpis">
      <Kpi
        label="active"
        value={f.duration(activeMs(props.view))}
        title={`Each turn from its prompt to its last step, added up: model ${f.duration(own().modelMs)}, tools ${f.duration(own().toolMs)}. ${f.duration(own().wallMs)} from the first message to the last.`}
      />
      <Kpi
        label={`tokens · ${Math.round(cached() * 100)}% cached`}
        value={f.tokens(totalOf(totals().usage))}
        title={`Every request resends the context, so this grows much faster than the context. Summed over all requests: ${f.tokens(sent())} sent (${f.tokens(totals().usage.input + totals().usage.cacheWrite)} new, ${f.tokens(totals().usage.cacheRead)} cached) and ${f.tokens(out())} generated.`}
      />
      <Kpi
        label={<CostKind cost={totals().cost} />}
        value={f.cost(totals().cost)}
        title={f.costNote(totals().cost, props.fallbackName)}
      />
      <Kpi
        label={`${totals().steps} req · ${totals().toolCalls} tools`}
        value={plural(own().turns, "turn")}
        title={`${plural(totals().steps, "request")} and ${plural(totals().toolCalls, "tool call")}${subagents() > 0 ? `, including ${plural(subagents(), "subagent")}` : ""}`}
      />
    </div>
  )
}

function CostKind(props: { readonly cost: Cost }) {
  return (
    <Switch>
      <Match when={props.cost.kind === "reported"}>cost{props.cost.partial ? " · some unpriced" : ""}</Match>
      <Match when={props.cost.kind === "estimated"}>cost · catalog prices</Match>
      <Match when={props.cost.kind === "fallback"}>cost · fallback prices</Match>
      <Match when={props.cost.kind === "none"}>no price</Match>
    </Switch>
  )
}

/** How far the character-count estimate may miss the measured total before the panel says to read the shares loosely. */
const ESTIMATE_OFF = 0.25

/**
 * What fills the context now, against the model's window: the headline share, one bar, the categories in columns, and
 * what the tool results are made of.
 */
function ContextPanel(props: { readonly data: Data; readonly palette: Palette; readonly tip: Tip }) {
  const latest = () => props.data.timeline.points[props.data.timeline.points.length - 1]
  const segments = createMemo((): Segment[] => {
    const point = latest()
    if (!point) return []
    return [...grouped(point.parts, props.palette)]
      .filter(([, value]) => value >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, value, ...props.palette.meta(key) }))
  })
  const tools = createMemo(() => {
    const point = latest()
    return point ? toolParts(point.parts) : []
  })
  const total = () => props.data.breakdown?.total ?? 0
  const limit = () => props.data.limit
  const ratio = () => (limit() ? total() / limit()! : 0)
  const shownTotal = tween(total)
  const shownShare = tween(() => ratio() * 100)
  const modelName = () => props.data.model?.name
  return (
    <div class="ocv-ctx">
      <Show
        when={props.data.breakdown}
        fallback={<div class="ocv-muted">No request has reported tokens yet.</div>}
      >
        {(breakdown) => (
          <>
            <div class="ocv-ctx-head" classList={{ "ocv-ctx-warn": ratio() >= 0.8 }}>
              <Show
                when={limit()}
                fallback={<span class="ocv-ctx-big ocv-num">{f.tokens(shownTotal())}</span>}
              >
                <span class="ocv-ctx-big ocv-num">{f.share(shownShare(), 100)}</span>
              </Show>
              <span class="ocv-ctx-what" title={modelName()}>
                context{modelName() ? ` · ${modelName()}` : ""}
              </span>
              <span class="ocv-ctx-of ocv-num">
                <Show when={limit()} fallback={<>in context</>}>
                  {f.tokens(shownTotal())} / {f.tokens(limit()!)}
                </Show>
              </span>
            </div>
            <StackBar segments={segments()} max={limit()} track tip={props.tip} height={10} />
            <Legend segments={segments()} total={limit() ?? breakdown().total} />
            <Show when={tools().length > 1}>
              <div class="ocv-ctx-tools ocv-small ocv-muted">
                <span class="ocv-swatch" style={{ background: props.palette.meta(TOOLS).color }} />
                <For each={tools().slice(0, 5)}>
                  {([name, value], i) => (
                    <span class="ocv-nowrap">
                      {i() > 0 ? " · " : ""}
                      {name} <span class="ocv-num">{f.tokens(value)}</span>
                    </span>
                  )}
                </For>
                <Show when={tools().length > 5}>
                  <span class="ocv-nowrap"> · +{tools().length - 5} more</span>
                </Show>
              </div>
            </Show>
            <Show when={ratio() >= 0.8}>
              <div class="ocv-small ocv-warn-text">Near the model's context limit</div>
            </Show>
            <Show when={Math.abs(breakdown().scale - 1) > ESTIMATE_OFF}>
              <div class="ocv-muted ocv-small ocv-note">
                Estimated shares of the latest request. The character-count estimate was off by{" "}
                {Math.round(Math.abs(breakdown().scale - 1) * 100)}%, so read them loosely.
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  )
}

function RequestsSection(props: {
  readonly data: Data
  readonly view: SessionView
  readonly palette: Palette
  readonly tip: Tip
  readonly selected?: string
  readonly onSelect: (step: string) => void
}) {
  // The chart has this session's requests; its subagents' run inside `task` calls and cost on top.
  const subagentCost = () => props.view.totals.cost.value - props.view.own.cost.value
  return (
    <Show when={props.data.timeline.points.length > 0}>
      <section class="ocv-section">
        <h3 title="What each request's context held (colors as in the context legend), what it produced, and what it cost. Click a column to open it in its turn.">
          Every request
          <Show when={props.data.timeline.compactions.length > 0}>
            <span class="ocv-muted ocv-small"> · dashed: compaction</span>
          </Show>
        </h3>
        <ContextChart
          points={props.data.timeline.points}
          compactions={props.data.timeline.compactions}
          palette={props.palette}
          limit={props.data.limit}
          tip={props.tip}
          step={(id) => props.data.steps.get(id)?.step}
          turn={(id) => props.data.steps.get(id)?.turn}
          selected={props.selected}
          onSelect={(point) => props.onSelect(point.step)}
        />
        <Show when={subagentCost() > 0.00005}>
          <div class="ocv-muted ocv-small ocv-note">
            Plus {f.usd(subagentCost())} in subagents, whose requests run inside the <code>task</code> calls.
          </div>
        </Show>
      </section>
    </Show>
  )
}

const timeSegments = (t: Turn): Segment[] => {
  const thinking = t.steps.reduce((sum, s) => sum + s.thinkingMs, 0)
  return [
    { ...TIME.thinking, value: thinking },
    { ...TIME.model, value: Math.max(0, t.modelMs - thinking) },
    { ...TIME.tools, value: t.toolMs },
    { ...TIME.other, value: t.otherMs },
  ]
}

/**
 * The turns, newest first, as an accordion: each row is a turn's prompt, time split and numbers, and opens into its
 * trace. The latest is open; click any other to open it too.
 */
function TurnsSection(props: {
  readonly view: SessionView
  readonly dashboard: Data
  readonly palette: Palette
  readonly tip: Tip
  readonly isOpen: (id: string) => boolean
  readonly onToggle: (id: string) => void
  readonly span?: string
  readonly onSpan: (id: string | undefined) => void
}) {
  // Keyed by id: the dashboard rebuilds its turns on every update, and a row should keep its node (so its bar eases)
  // and only a turn that just started should slide in. A batch of new ids (the first paint, another session) doesn't.
  const byId = createMemo(() => new Map(props.view.turns.map((t) => [t.id, t])))
  const newest = () => props.view.turns.map((t) => t.id).reverse()
  const seen = new Set<string>()
  let first = true
  const fresh = createMemo(() => {
    const added = props.view.turns.map((t) => t.id).filter((id) => !seen.has(id))
    for (const id of added) seen.add(id)
    const out = first || added.length > 2 ? new Set<string>() : new Set(added)
    first = false
    return out
  })
  const longest = () => props.view.turns.reduce((max, t) => Math.max(max, t.ms), 1)
  return (
    <section class="ocv-section">
      <h3 title="Newest first; click one to open its trace. Bars: violet thinking, green generating, orange tools, grey waiting.">
        Turns
      </h3>
      <ol class="ocv-turns">
        <For each={newest()}>
          {(id) => {
            const enter = fresh().has(id)
            return (
              <Show when={byId().get(id)}>
                {(turn) => (
                  <TurnRow
                    turn={turn()}
                    enter={enter}
                    max={longest()}
                    tip={props.tip}
                    open={props.isOpen(id)}
                    onToggle={() => props.onToggle(id)}
                  >
                    <TurnTrace
                      turn={turn()}
                      dashboard={props.dashboard}
                      palette={props.palette}
                      now={turn().end}
                      tip={props.tip}
                      selected={props.span}
                      onSelect={props.onSpan}
                    />
                  </TurnRow>
                )}
              </Show>
            )
          }}
        </For>
      </ol>
    </section>
  )
}

function TurnRow(props: {
  readonly turn: Turn
  readonly enter: boolean
  readonly max: number
  readonly tip: Tip
  readonly open: boolean
  readonly onToggle: () => void
  /** The trace, shown while open. */
  readonly children: JSX.Element
}) {
  const prompt = () => f.firstLine(props.turn.prompt) || (props.turn.prompt ? f.firstLine(props.turn.prompt.replace(/<[^>]+>/g, " ")) : "(before the first prompt)")
  const detail = () =>
    `Started ${f.clock(props.turn.start)} · ${props.turn.steps.length} requests, ${props.turn.toolCalls} tool calls · ${f.tokens(totalOf(props.turn.usage))} tokens · peak ${f.tokens(props.turn.peakContext)} context · ${f.cost(props.turn.cost)} (${f.costNote(props.turn.cost)})`
  return (
    <li
      class="ocv-turn"
      data-turn={props.turn.id}
      classList={{ "ocv-open": props.open, "ocv-running": props.turn.running, "ocv-enter": props.enter }}
      // Once played, so the row doesn't replay it when the list moves it.
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.classList.remove("ocv-enter")
      }}
    >
      <button class="ocv-turn-head" onClick={props.onToggle} aria-expanded={props.open} title={detail()}>
        <div class="ocv-row">
          <span class="ocv-turn-chevron" aria-hidden="true" />
          <span class="ocv-turn-index">#{props.turn.index + 1}</span>
          <span class="ocv-turn-prompt">{prompt()}</span>
          <span class="ocv-num" classList={{ "ocv-live": props.turn.running }}>
            {f.duration(props.turn.ms)}
          </span>
        </div>
        <div class="ocv-turn-line">
          <div class="ocv-turn-bar">
            <StackBar segments={timeSegments(props.turn)} max={props.max} tip={props.tip} format={f.duration} height={6} />
          </div>
          <span class="ocv-turn-meta ocv-num ocv-muted ocv-small">
            <Show when={props.turn.running}>
              <span class="ocv-live">running · </span>
            </Show>
            {props.turn.steps.length} req<span class="ocv-turn-tok"> · {f.tokens(totalOf(props.turn.usage))}</span> ·{" "}
            {f.cost(props.turn.cost)}
          </span>
        </div>
      </button>
      <Show when={props.open}>
        <div class="ocv-turn-body ocv-fade-in">{props.children}</div>
      </Show>
    </li>
  )
}

type SortKey = "ms" | "calls" | "outputTokens"

function ToolsSection(props: { readonly tools: readonly ToolStat[] }) {
  const [sort, setSort] = createSignal<SortKey>("ms")
  const sorted = () => [...props.tools].sort((a, b) => b[sort()] - a[sort()])
  const most = (key: SortKey) => props.tools.reduce((max, t) => Math.max(max, t[key]), 0) || 1
  const focus = useFocus()
  const Head = (p: { readonly key: SortKey; readonly label: string; readonly title: string }) => (
    <th class="ocv-num" title={p.title}>
      <button class="ocv-sort" classList={{ "ocv-sorted": sort() === p.key }} onClick={() => setSort(p.key)}>
        {p.label}
        {sort() === p.key ? " ↓" : ""}
      </button>
    </th>
  )
  // The sorted column carries a bar behind its number, so the ranking reads without reading the numbers.
  const Cell = (p: { readonly key: SortKey; readonly tool: ToolStat; readonly title?: string; readonly children: JSX.Element }) => (
    <td class="ocv-num" classList={{ "ocv-bar-cell": sort() === p.key }} title={p.title}>
      <Show when={sort() === p.key}>
        <span class="ocv-cell-bar" style={{ width: `${(p.tool[p.key] / most(p.key)) * 100}%` }} />
      </Show>
      <span class="ocv-cell-text">{p.children}</span>
    </td>
  )
  return (
    <Show when={props.tools.length > 0}>
      <section class="ocv-section">
        <h3>Tools</h3>
        <table class="ocv-table" {...famProps(focus, TOOLS)}>
          <thead>
            <tr>
              <th>Tool</th>
              <Head key="calls" label="Calls" title="Calls, including subagents'" />
              <Head key="ms" label="Time" title="Total execution time; hover a cell for the longest single call" />
              <Head key="outputTokens" label="Output" title="Estimated tokens of results returned to the model" />
            </tr>
          </thead>
          <tbody>
            <For each={sorted()}>
              {(tool) => (
                <tr>
                  <td>
                    {tool.name}
                    <Show when={tool.errors > 0}>
                      <span class="ocv-error-text ocv-small"> · {tool.errors} failed</span>
                    </Show>
                  </td>
                  <Cell key="calls" tool={tool}>
                    {tool.calls}
                  </Cell>
                  <Cell key="ms" tool={tool} title={`Longest call: ${f.duration(tool.maxMs)}`}>
                    {f.duration(tool.ms)}
                  </Cell>
                  <Cell key="outputTokens" tool={tool}>
                    ~{f.tokens(tool.outputTokens)}
                  </Cell>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </section>
    </Show>
  )
}
