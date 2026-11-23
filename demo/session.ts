import type { MountedSession } from "@opencode/plugin/gui"
import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import { createSignal } from "solid-js"
import { step, user } from "../test/fixtures"

// A made-up but plausible session (a few turns, a subagent), in the shape OpenCode Desktop hands the dashboard, so it
// runs anywhere: the demo page (main.tsx) and the docs page (docs.tsx).

const T0 = Date.UTC(2026, 10, 18, 9, 12, 0)
const at = (seconds: number) => T0 + Math.round(seconds * 1000)

const LINES = [
  `import { createSignal, Show } from "solid-js"`,
  `export function ReportsPage(props: { readonly report: Report }) {`,
  `  const [columns, setColumns] = createSignal<Column[]>(DEFAULT_COLUMNS)`,
  `  return <section class="report">{props.children}</section>`,
  `  expect(render(() => <ReportsPage report={fixture} />)).toMatchSnapshot()`,
  `const rows = report.rows.map((row) => columns.map((c) => quote(row[c.key])))`,
  `  download(new Blob([toCsv(rows)], { type: "text/csv" }), report.name + ".csv")`,
  `}`,
]
/** Code-like text of about `n` characters. */
const filler = (n: number) => {
  let out = ""
  for (let i = 0; out.length < n; i++) out += `${LINES[(i * 5 + n) % LINES.length]}\n`
  return out.slice(0, n)
}

interface Tool {
  readonly name: string
  readonly input: Record<string, string>
  readonly output: number
  readonly dur: number
  readonly child?: string
}

/** Builds a transcript whose token counts follow what it holds: each request reads the last one's context from cache. */
function transcript(system: number) {
  const messages: SessionMessageInfo[] = []
  let context = system
  let cached = 0
  return {
    messages,
    user(seconds: number, text: string) {
      messages.push(user(at(seconds), text))
      context += Math.round(text.length / 4)
    },
    step(s: {
      readonly at: number
      readonly streamed: number
      readonly output: number
      readonly reasoning?: number
      readonly text?: string
      readonly tools?: readonly Tool[]
    }) {
      const tools = (s.tools ?? []).map((t, i) => ({
        name: t.name,
        created: at(s.streamed - 0.4 + i * 0.05),
        ran: at(s.streamed + i * 0.05),
        completed: at(s.streamed + i * 0.05 + t.dur),
        input: t.input,
        output: filler(t.output),
        child: t.child,
      }))
      const completed = Math.max(at(s.streamed), ...tools.map((t) => t.completed))
      const fresh = 180
      messages.push(
        step({
          created: at(s.at),
          streamed: at(s.streamed),
          completed,
          model: "claude-sonnet-4-5",
          reasoning: s.reasoning ? filler(s.reasoning * 4) : undefined,
          text: s.text,
          tools,
          tokens: { input: fresh, read: cached, write: context - cached - fresh, output: s.output, reasoning: s.reasoning },
        }),
      )
      cached = context
      context += s.output + (s.reasoning ?? 0) + tools.reduce((sum, t) => sum + Math.round(t.output.length / 4), 0)
    },
  }
}

const ROOT = "ses_root"
const CHILD = "ses_explore"

const root = transcript(16_400)
root.user(0, "Add an Export to CSV button to the reports page.")
root.step({
  at: 1.5,
  streamed: 7,
  output: 160,
  reasoning: 340,
  tools: [
    { name: "glob", input: { pattern: "src/reports/**" }, output: 220, dur: 0.2 },
    { name: "read", input: { filePath: "src/reports/page.tsx" }, output: 18_000, dur: 0.3 },
  ],
})
root.step({
  at: 7.6,
  streamed: 14,
  output: 140,
  reasoning: 260,
  tools: [
    { name: "read", input: { filePath: "src/reports/table.ts" }, output: 5400, dur: 0.2 },
    { name: "grep", input: { pattern: "download\\(" }, output: 900, dur: 0.4 },
  ],
})
root.step({
  at: 14.8,
  streamed: 33,
  output: 1450,
  reasoning: 980,
  tools: [
    { name: "edit", input: { filePath: "src/reports/page.tsx", oldString: filler(700), newString: filler(1300) }, output: 60, dur: 0.3 },
    { name: "edit", input: { filePath: "src/reports/table.ts", oldString: filler(300), newString: filler(800) }, output: 60, dur: 0.2 },
    { name: "write", input: { filePath: "src/reports/export-csv.ts", content: filler(1600) }, output: 60, dur: 0.2 },
  ],
})
root.step({
  at: 34,
  streamed: 37,
  output: 70,
  tools: [{ name: "bash", input: { command: "bun test src/reports" }, output: 2600, dur: 11.5 }],
})
root.step({
  at: 49,
  streamed: 56,
  output: 210,
  text: "Added an Export to CSV button above the report table. It quotes commas and newlines, and names the file after the report. Tests pass.",
})

root.user(190, "Also let me pick which columns go into the export.")
root.step({
  at: 191,
  streamed: 198,
  output: 120,
  reasoning: 520,
  tools: [{ name: "read", input: { filePath: "src/reports/export-csv.ts" }, output: 1700, dur: 0.2 }],
})
root.step({
  at: 199,
  streamed: 220,
  output: 1250,
  reasoning: 760,
  tools: [
    { name: "edit", input: { filePath: "src/reports/export-csv.ts", oldString: filler(900), newString: filler(1700) }, output: 60, dur: 0.2 },
    { name: "edit", input: { filePath: "src/reports/page.tsx", oldString: filler(400), newString: filler(900) }, output: 60, dur: 0.2 },
  ],
})
root.step({
  at: 221,
  streamed: 224,
  output: 80,
  tools: [
    { name: "bash", input: { command: "bun run typecheck && bun test src/reports" }, output: 3100, dur: 17 },
  ],
})
root.step({
  at: 242,
  streamed: 248,
  output: 170,
  text: "The export button now opens a column picker. It starts from the visible columns and remembers your last choice.",
})

root.user(610, "Commit this.")
root.step({
  at: 611,
  streamed: 614,
  output: 90,
  tools: [{ name: "bash", input: { command: "git status && git diff --stat" }, output: 700, dur: 0.4 }],
})
root.step({
  at: 615,
  streamed: 620,
  output: 160,
  tools: [{ name: "bash", input: { command: 'git commit -am "Add CSV export with a column picker to reports"' }, output: 240, dur: 0.6 }],
})
root.step({ at: 621, streamed: 624, output: 60, text: "Committed as 4f2c1a9." })

root.user(905, "CI fails on the reports snapshot test. Can you look into it?")
root.step({
  at: 906,
  streamed: 911,
  output: 180,
  reasoning: 420,
  tools: [
    {
      name: "task",
      input: { description: "Find the failing snapshot", prompt: "Find which snapshot test covers the reports page and why it changed.", subagent_type: "explore" },
      output: 1400,
      dur: 41,
      child: CHILD,
    },
  ],
})
root.step({
  at: 953,
  streamed: 958,
  output: 90,
  reasoning: 150,
  tools: [{ name: "bash", input: { command: "bun test -u src/reports/page.test.tsx" }, output: 1800, dur: 8.5 }],
})
root.step({
  at: 967.5,
  streamed: 974,
  output: 190,
  text: "The snapshot still had the old reports markup. Updated it; the new export button is the only difference.",
})

const child = transcript(9_800)
child.user(911.5, "Find which snapshot test covers the reports page and why it changed.")
child.step({
  at: 912,
  streamed: 916,
  output: 90,
  reasoning: 180,
  tools: [{ name: "grep", input: { pattern: "toMatchSnapshot" }, output: 1300, dur: 0.5 }],
})
child.step({
  at: 917,
  streamed: 922,
  output: 110,
  tools: [
    { name: "read", input: { filePath: "src/reports/__snapshots__/page.test.tsx.snap" }, output: 14_000, dur: 0.3 },
    { name: "read", input: { filePath: "src/reports/page.test.tsx" }, output: 5200, dur: 0.2 },
  ],
})
child.step({
  at: 923,
  streamed: 951,
  output: 420,
  reasoning: 610,
  text: "page.test.tsx snapshots the whole reports page; the stored snapshot predates the new export button.",
})

const model = {
  id: "claude-sonnet-4-5",
  modelID: "claude-sonnet-4-5",
  providerID: "p",
  name: "Claude Sonnet 4.5",
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
  limit: { context: 200_000, output: 64_000 },
} as unknown as ModelInfo

const all: Record<string, SessionMessageInfo[]> = { [ROOT]: root.messages, [CHILD]: child.messages }
const titles: Record<string, { title: string; agent?: string }> = {
  [ROOT]: { title: "CSV export for reports" },
  [CHILD]: { title: "Find the failing snapshot", agent: "explore" },
}
const done = async () => {}

// Replay shows the session up to a moment in its own time, a message at a time; Infinity shows all of it.
const [cut, setCut] = createSignal(Number.POSITIVE_INFINITY)
const list = (id: string) => (all[id] ?? []).filter((m) => m.time.created <= cut())

const data = {
  session: {
    message: {
      list,
      sync: done,
      more: () => false,
      loadMore: done,
      loading: () => false,
    },
    status: () => "idle",
    family: (id: string) => (id === ROOT ? [CHILD] : []),
    get: (id: string) => titles[id],
    missing: () => false,
    sync: done,
  },
  location: { model: { list: () => [model], sync: done } },
}

export const session = { id: ROOT, location: {}, server: { data } } as unknown as MountedSession

// Every moment something new arrives, in order.
const moments = [...new Set(Object.values(all).flatMap((ms) => ms.map((m) => m.time.created)))].sort((a, b) => a - b)
const LABEL = "▶ Replay the session"

/** A button that plays the session back a message at a time, a beat apart: the dashboard grows the way it does live. */
export function replayButton(className: string): HTMLButtonElement {
  const button = Object.assign(document.createElement("button"), { type: "button", className, textContent: LABEL })
  let timer: ReturnType<typeof setInterval> | undefined
  button.addEventListener("click", () => {
    clearInterval(timer)
    let i = 0
    setCut(moments[0]! - 1)
    button.disabled = true
    button.textContent = "Replaying…"
    timer = setInterval(() => {
      if (i < moments.length) return void setCut(moments[i++]!)
      clearInterval(timer)
      setCut(Number.POSITIVE_INFINITY)
      button.disabled = false
      button.textContent = LABEL
    }, 650)
  })
  return button
}
