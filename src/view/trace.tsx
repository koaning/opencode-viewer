import { createMemo, createSignal, For, Match, Show, Switch, type JSX } from "solid-js"
import type { Dashboard, SessionView } from "../data"
import * as f from "../format"
import { contextOf, totalOf, type ContextPoint, type Marker, type Step, type ToolCall, type Turn } from "../model"
import { grouped, NEUTRAL, PRODUCED, TIME, type Palette } from "./buckets"
import { Legend, StackBar, type Segment } from "./charts"
import type { Tip } from "./tip"

// A turn as a waterfall, after wigglystuff's TraceView: one row per span (its requests, their tool calls, subagents'
// requests under their `task` call), indented under its parent, with a bar on the turn's timeline and its duration.
// The turn itself is the timeline, so it gets no row of its own. Click a row for its details.

type State = "running" | "ok" | "error"

interface Bar {
  readonly start: number
  readonly end: number
  readonly color: string
  readonly label: string
  /** Its family, for the dashboard's shared highlight (see focus.ts). */
  readonly fam: string
}

interface Row {
  readonly id: string
  readonly depth: number
  readonly kind: "request" | "tool" | "marker"
  readonly label: string
  readonly detail: string
  readonly start: number
  readonly end: number
  readonly state: State
  readonly bars: readonly Bar[]
  readonly kids: number
  readonly step?: Step
  readonly tool?: ToolCall
  readonly marker?: Marker
  readonly session?: SessionView
}

const stepEnd = (step: Step, now: number) => step.completed ?? (step.running ? now : step.created + step.ms)

/** A request's bar: thinking where its reasoning ran, generating for the rest of the model's time, then its tools. */
const requestBars = (step: Step, now: number): Bar[] => {
  const end = stepEnd(step, now)
  const modelEnd = step.created + step.modelMs
  const bars: Bar[] = [{ start: step.created, end: modelEnd, color: TIME.model.color, label: TIME.model.label, fam: TIME.model.key }]
  for (const [start, stop] of step.thinking)
    bars.push({ start: Math.max(step.created, start), end: Math.min(modelEnd, stop), color: TIME.thinking.color, label: TIME.thinking.label, fam: TIME.thinking.key })
  if (end > modelEnd) bars.push({ start: modelEnd, end, color: NEUTRAL, label: "Running its tools", fam: TIME.other.key })
  return bars
}

const stateOf = (running: boolean, error: boolean): State => (running ? "running" : error ? "error" : "ok")

/** The rows of a turn, with folded subtrees left out: its requests and markers in time order, each request's tools under it. */
const rowsOf = (turn: Turn, dashboard: Dashboard, now: number, open: (id: string, byDefault: boolean) => boolean): Row[] => {
  const steps = (list: readonly Step[], depth: number, seen: Set<string>, rows: Row[] = []): Row[] => {
    for (const step of list) {
      rows.push({
        id: step.id,
        depth,
        kind: "request",
        label: step.model.id.split("/").pop() || step.model.id,
        detail: `${f.tokens(step.context)} ctx · ${f.tokens(step.usage.output + step.usage.reasoning)} out`,
        start: step.created,
        end: stepEnd(step, now),
        state: stateOf(step.running, !!step.error),
        bars: requestBars(step, now),
        kids: step.tools.length,
        step,
      })
      if (!open(step.id, true)) continue
      for (const tool of step.tools) {
        const child = tool.child ? dashboard.sessions.get(tool.child) : undefined
        const childSteps = child && !seen.has(child.id) ? child.turns.flatMap((t) => t.steps) : []
        const start = tool.ran ?? tool.created
        const end = tool.completed ?? (tool.status === "running" && step.running ? now : start + tool.ms)
        rows.push({
          id: tool.id,
          depth: depth + 1,
          kind: "tool",
          label: tool.name,
          detail: child ? `${child.title || "subagent"} · ${childSteps.length} req` : tool.summary,
          start,
          end,
          state: stateOf(tool.status === "running" && step.running, tool.status === "error"),
          bars: [{ start, end, color: TIME.tools.color, label: TIME.tools.label, fam: TIME.tools.key }],
          kids: childSteps.length,
          tool,
          session: child,
        })
        // A subagent's requests nest under its call, folded until asked for.
        if (child && childSteps.length && open(tool.id, false)) steps(childSteps, depth + 2, new Set([...seen, child.id]), rows)
      }
    }
    return rows
  }
  const groups: Row[][] = turn.steps.map((step) => steps([step], 0, new Set()))
  for (const marker of turn.markers)
    groups.push([
      {
        id: marker.id,
        depth: 0,
        kind: "marker",
        label: marker.label,
        detail: "",
        start: marker.time,
        end: marker.time,
        state: "ok",
        bars: [],
        kids: 0,
        marker,
      },
    ])
  return groups.sort((a, b) => a[0]!.start - b[0]!.start).flat()
}

/** Round tick steps for a span of `ms`, about four of them. */
const ticks = (ms: number): number[] => {
  const steps = [100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]
  const step = steps.find((s) => ms / s <= 5) ?? Math.ceil(ms / 4 / 3_600_000) * 3_600_000
  const out: number[] = []
  for (let t = 0; t <= ms; t += step) out.push(t)
  return out
}

const INDENT = 12

export function TurnTrace(props: {
  readonly turn: Turn
  readonly dashboard: Dashboard
  readonly palette: Palette
  readonly now: number
  readonly tip: Tip
  readonly selected?: string
  readonly onSelect: (id: string | undefined) => void
}) {
  // Folding, by row id; rows not listed keep their default (requests open, subagents folded).
  const [folds, setFolds] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const open = (id: string, byDefault: boolean) => folds().get(id) ?? byDefault
  const toggle = (row: Row) =>
    setFolds((map) => new Map(map).set(row.id, !open(row.id, row.kind !== "tool")))

  const rows = createMemo(() => rowsOf(props.turn, props.dashboard, props.now, open))
  const t0 = () => props.turn.start
  const span = () => Math.max(1, props.turn.end - props.turn.start)
  const left = (time: number) => `${Math.max(0, Math.min(100, ((time - t0()) / span()) * 100))}%`
  const width = (start: number, end: number) => `${Math.max(0, ((Math.min(end, props.turn.end) - Math.max(start, t0())) / span()) * 100)}%`
  const selectedRow = () => rows().find((r) => r.id === props.selected)

  return (
    <div class="ocv-trace">
      <div class="ocv-trace-row ocv-trace-head">
        <div>Request</div>
        <div class="ocv-trace-axis">
          <For each={ticks(span()).filter((tick) => tick / span() < 0.78)}>
            {(tick) => <span style={{ left: `${(tick / span()) * 100}%` }}>{tick === 0 ? "0" : f.duration(tick)}</span>}
          </For>
        </div>
        <div class="ocv-num">Took</div>
      </div>
      <div class="ocv-trace-body">
        <For each={rows()}>
          {(row) => (
            <div
              class={`ocv-trace-row ocv-trace-${row.kind} ocv-state-${row.state}`}
              classList={{ "ocv-trace-selected": row.id === props.selected }}
              onClick={() => props.onSelect(row.id === props.selected ? undefined : row.id)}
            >
              <div class="ocv-trace-name" style={{ "padding-left": `${row.depth * INDENT}px` }}>
                <Show when={row.kids > 0} fallback={<span class="ocv-trace-toggle" />}>
                  <button
                    class="ocv-trace-toggle"
                    title={open(row.id, row.kind !== "tool") ? "Fold" : `Show ${row.kids}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggle(row)
                    }}
                  >
                    {open(row.id, row.kind !== "tool") ? "−" : "+"}
                  </button>
                </Show>
                <span class={`ocv-pip ocv-pip-${row.state}`} />
                <span class="ocv-trace-label" title={row.label}>
                  {row.label}
                </span>
                <span class="ocv-trace-detail" title={row.detail}>
                  {row.detail}
                </span>
              </div>
              <div class="ocv-trace-lane">
                <For each={ticks(span())}>{(tick) => <span class="ocv-grid" style={{ left: `${(tick / span()) * 100}%` }} />}</For>
                <Show
                  when={row.kind !== "marker"}
                  fallback={<span class="ocv-instant" style={{ left: left(row.start) }} title={row.label} />}
                >
                  <For each={row.bars}>
                    {(bar) => (
                      <span
                        class="ocv-trace-bar"
                        data-fam={bar.fam}
                        style={{ left: left(bar.start), width: width(bar.start, bar.end), background: bar.color }}
                        onPointerMove={(event) =>
                          props.tip.show(
                            event,
                            <>
                              <div class="ocv-tip-title">
                                <span class="ocv-swatch" style={{ background: bar.color }} />
                                {bar.label}
                              </div>
                              <div>
                                {f.duration(bar.end - bar.start)} · from +{f.duration(bar.start - t0())}
                              </div>
                            </>,
                          )
                        }
                        onPointerLeave={() => props.tip.hide()}
                      />
                    )}
                  </For>
                </Show>
              </div>
              <div class="ocv-num ocv-trace-took">
                {row.kind === "marker" ? "" : row.state === "running" ? <span class="ocv-live">{f.duration(row.end - row.start)}</span> : f.duration(row.end - row.start)}
              </div>
            </div>
          )}
        </For>
      </div>
      <Show when={selectedRow()} fallback={<TurnFooter turn={props.turn} />}>
        {(row) => <Details row={row()} dashboard={props.dashboard} palette={props.palette} t0={t0()} tip={props.tip} />}
      </Show>
    </div>
  )
}

function KV(props: { readonly k: string; readonly children: JSX.Element }) {
  return (
    <>
      <dt>{props.k}</dt>
      <dd>{props.children}</dd>
    </>
  )
}

function Pill(props: { readonly state: State }) {
  return <span class={`ocv-pill ocv-pill-${props.state}`}>{{ running: "Running", ok: "Ok", error: "Error" }[props.state]}</span>
}

function Details(props: { readonly row: Row; readonly dashboard: Dashboard; readonly palette: Palette; readonly t0: number; readonly tip: Tip }) {
  const header = () => (
    <div class="ocv-details-head">
      <span class="ocv-details-title">{props.row.label}</span>
      <Pill state={props.row.state} />
      <span class="ocv-muted">
        starts +{f.duration(props.row.start - props.t0)} · took {f.duration(props.row.end - props.row.start)}
      </span>
    </div>
  )
  return (
    <div class="ocv-details">
      {header()}
      <Switch>
        <Match when={props.row.step}>{(step) => <StepDetails step={step()} dashboard={props.dashboard} palette={props.palette} tip={props.tip} />}</Match>
        <Match when={props.row.tool}>{(tool) => <ToolDetails tool={tool()} session={props.row.session} />}</Match>
        <Match when={props.row.marker}>{(marker) => <div class="ocv-muted">{marker().label}</div>}</Match>
      </Switch>
    </div>
  )
}

function StepDetails(props: { readonly step: Step; readonly dashboard: Dashboard; readonly palette: Palette; readonly tip: Tip }) {
  const point = (): ContextPoint | undefined => props.dashboard.timeline.points.find((p) => p.step === props.step.id)
  const segments = (): Segment[] => {
    const p = point()
    if (!p) return []
    return [...grouped(p.parts, props.palette)]
      .filter(([, v]) => v >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([key, value]) => ({ key, value, ...props.palette.meta(key) }))
  }
  const produced = (): Segment[] => {
    const p = point()
    if (!p) return []
    return (["reasoning", "text", "calls"] as const).map((kind) => ({ value: p.produced[kind], ...PRODUCED[kind] }))
  }
  const s = () => props.step
  return (
    <>
      <Show when={s().error}>
        <div class="ocv-error-text">{s().error}</div>
      </Show>
      <dl class="ocv-kv">
        <KV k="model">
          {s().model.providerID}/{s().model.id}
          {s().model.variant && s().model.variant !== "default" ? ` (${s().model.variant})` : ""} · {s().agent}
        </KV>
        <KV k="finish">{s().finish ?? (s().running ? "running" : "—")}</KV>
        <KV k="time">
          <Show when={s().ttftMs !== undefined}>first token {f.duration(s().ttftMs!)} · </Show>
          <Show when={s().thinkingMs > 0}>thinking {f.duration(s().thinkingMs)} · </Show>
          generating {f.duration(s().modelMs - s().thinkingMs)} · tools {f.duration(s().toolMs)}
        </KV>
        <KV k="tokens">
          {f.tokens(contextOf(s().usage))} context ({f.tokens(s().usage.input)} new · {f.tokens(s().usage.cacheRead)} cached
          {s().usage.cacheWrite ? ` · ${f.tokens(s().usage.cacheWrite)} cache write` : ""}) · {f.tokens(s().usage.output)} out
          {s().usage.reasoning ? ` · ${f.tokens(s().usage.reasoning)} reasoning` : ""}
        </KV>
        <KV k="cost">
          <span title={f.costNote(s().cost)}>{f.cost(s().cost)}</span>
        </KV>
      </dl>
      <Show when={segments().length}>
        <h4>What its context held</h4>
        <StackBar segments={segments()} tip={props.tip} height={10} />
        <Legend segments={segments().slice(0, 6)} total={point()!.total} />
        <h4>What it produced</h4>
        <Legend segments={produced().filter((p) => p.value >= 1)} />
      </Show>
      <Show when={s().reasoning.trim()}>
        <details class="ocv-preview">
          <summary>Thinking · {f.tokens(s().reasoningChars / 4)} tokens est.</summary>
          <pre>{s().reasoning}</pre>
        </details>
      </Show>
      <Show when={s().text.trim()}>
        <details class="ocv-preview" open>
          <summary>Text</summary>
          <pre>{s().text}</pre>
        </details>
      </Show>
    </>
  )
}

const pretty = (value: unknown) => {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolDetails(props: { readonly tool: ToolCall; readonly session?: SessionView }) {
  const t = () => props.tool
  return (
    <>
      <Show when={t().error}>
        <div class="ocv-error-text">{t().error}</div>
      </Show>
      <dl class="ocv-kv">
        <KV k="status">{t().status}</KV>
        <KV k="time">
          {t().ran !== undefined ? `waited ${f.duration(t().ran! - t().created)} to start · ` : ""}ran {f.duration(t().ms)}
        </KV>
        <KV k="result">
          {f.tokens(t().outputChars / 4)} tokens est. into the context ({t().outputChars.toLocaleString()} chars)
        </KV>
        <Show when={props.session}>
          {(view) => (
            <KV k="subagent">
              {view().title || view().id} · {view().totals.steps} requests · {f.tokens(totalOf(view().totals.usage))} tokens ·{" "}
              {f.cost(view().totals.cost)}
            </KV>
          )}
        </Show>
      </dl>
      <details class="ocv-preview" open>
        <summary>Input</summary>
        <pre>{pretty(t().input).slice(0, 4000)}</pre>
      </details>
      <Show when={t().output}>
        <details class="ocv-preview">
          <summary>Output{t().outputChars > t().output.length ? ` (first ${t().output.length.toLocaleString()} chars)` : ""}</summary>
          <pre>{t().output}</pre>
        </details>
      </Show>
    </>
  )
}

/** With no row picked: the turn's full prompt (the list above only shows its first line), folded. */
function TurnFooter(props: { readonly turn: Turn }) {
  const prompt = () => f.stripBlocks(props.turn.prompt).trim() || props.turn.prompt
  return (
    <div class="ocv-trace-hint">
      <Show when={prompt()} fallback={<span class="ocv-muted ocv-small">Click a row for its details.</span>}>
        <details class="ocv-preview ocv-trace-prompt">
          <summary>
            Prompt <span class="ocv-small">· click a row for its details</span>
          </summary>
          <pre>{prompt()}</pre>
        </details>
      </Show>
    </div>
  )
}
