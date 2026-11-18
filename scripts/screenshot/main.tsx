import type { MountedSession } from "@opencode/plugin/gui"
import type { ModelInfo, SessionMessageInfo } from "@opencode/client"
import { render } from "solid-js/web"
import css from "../../src/style.css?inline"
import { Dashboard } from "../../src/view/dashboard"
import { step, user } from "../../test/fixtures"

// A made-up but plausible session (a few turns, a subagent), so the dashboard can be shown outside OpenCode Desktop.

const T0 = Date.UTC(2026, 10, 18, 9, 12, 0)
const at = (seconds: number) => T0 + Math.round(seconds * 1000)

const LINES = [
  `import { createSignal, Show } from "solid-js"`,
  `export function SettingsPage(props: { readonly user: User }) {`,
  `  const [theme, setTheme] = createSignal<Theme>(load() ?? "light")`,
  `  return <section class="settings">{props.children}</section>`,
  `  expect(render(() => <SettingsPage user={fixture} />)).toMatchSnapshot()`,
  `const media = matchMedia("(prefers-color-scheme: dark)")`,
  `  localStorage.setItem(KEY, JSON.stringify({ theme: value }))`,
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
root.user(0, "Add a dark mode toggle to the settings page and remember the choice.")
root.step({
  at: 1.5,
  streamed: 7,
  output: 160,
  reasoning: 340,
  tools: [
    { name: "glob", input: { pattern: "src/**/settings*" }, output: 220, dur: 0.2 },
    { name: "read", input: { filePath: "src/settings/page.tsx" }, output: 18_000, dur: 0.3 },
  ],
})
root.step({
  at: 7.6,
  streamed: 14,
  output: 140,
  reasoning: 260,
  tools: [
    { name: "read", input: { filePath: "src/theme.ts" }, output: 5400, dur: 0.2 },
    { name: "grep", input: { pattern: "prefers-color-scheme" }, output: 900, dur: 0.4 },
  ],
})
root.step({
  at: 14.8,
  streamed: 33,
  output: 1450,
  reasoning: 980,
  tools: [
    { name: "edit", input: { filePath: "src/settings/page.tsx", oldString: filler(700), newString: filler(1300) }, output: 60, dur: 0.3 },
    { name: "edit", input: { filePath: "src/theme.ts", oldString: filler(300), newString: filler(800) }, output: 60, dur: 0.2 },
    { name: "write", input: { filePath: "src/settings/use-theme.ts", content: filler(1600) }, output: 60, dur: 0.2 },
  ],
})
root.step({
  at: 34,
  streamed: 37,
  output: 70,
  tools: [{ name: "bash", input: { command: "bun test src/settings" }, output: 2600, dur: 11.5 }],
})
root.step({
  at: 49,
  streamed: 56,
  output: 210,
  text: "Added a Dark mode switch to Settings → Appearance. The choice is stored in localStorage and applied before first paint, so there is no flash. Tests pass.",
})

root.user(190, "Also add a 'system' option that follows the OS setting.")
root.step({
  at: 191,
  streamed: 198,
  output: 120,
  reasoning: 520,
  tools: [{ name: "read", input: { filePath: "src/settings/use-theme.ts" }, output: 1700, dur: 0.2 }],
})
root.step({
  at: 199,
  streamed: 220,
  output: 1250,
  reasoning: 760,
  tools: [
    { name: "edit", input: { filePath: "src/settings/use-theme.ts", oldString: filler(900), newString: filler(1700) }, output: 60, dur: 0.2 },
    { name: "edit", input: { filePath: "src/settings/page.tsx", oldString: filler(400), newString: filler(900) }, output: 60, dur: 0.2 },
  ],
})
root.step({
  at: 221,
  streamed: 224,
  output: 80,
  tools: [
    { name: "bash", input: { command: "bun run typecheck && bun test src/settings" }, output: 3100, dur: 17 },
  ],
})
root.step({
  at: 242,
  streamed: 248,
  output: 170,
  text: "Added System as a third option. It follows prefers-color-scheme and updates live when the OS switches.",
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
  tools: [{ name: "bash", input: { command: 'git commit -am "Add dark and system themes to settings"' }, output: 240, dur: 0.6 }],
})
root.step({ at: 621, streamed: 624, output: 60, text: "Committed as 4f2c1a9." })

root.user(905, "CI fails on the settings snapshot test. Can you look into it?")
root.step({
  at: 906,
  streamed: 911,
  output: 180,
  reasoning: 420,
  tools: [
    {
      name: "task",
      input: { description: "Find the failing snapshot", prompt: "Find which snapshot test covers the settings page and why it changed.", subagent_type: "explore" },
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
  tools: [{ name: "bash", input: { command: "bun test -u src/settings/page.test.tsx" }, output: 1800, dur: 8.5 }],
})
root.step({
  at: 967.5,
  streamed: 974,
  output: 190,
  text: "The snapshot still had the old settings markup. Updated it; the new toggle is the only difference.",
})

const child = transcript(9_800)
child.user(911.5, "Find which snapshot test covers the settings page and why it changed.")
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
    { name: "read", input: { filePath: "src/settings/__snapshots__/page.test.tsx.snap" }, output: 14_000, dur: 0.3 },
    { name: "read", input: { filePath: "src/settings/page.test.tsx" }, output: 5200, dur: 0.2 },
  ],
})
child.step({
  at: 923,
  streamed: 951,
  output: 420,
  reasoning: 610,
  text: "page.test.tsx snapshots the whole settings page; the stored snapshot predates the new Appearance toggle.",
})

const model = {
  id: "claude-sonnet-4-5",
  modelID: "claude-sonnet-4-5",
  providerID: "p",
  name: "Claude Sonnet 4.5",
  cost: [{ input: 3, output: 15, cache: { read: 0.3, write: 3.75 } }],
  limit: { context: 200_000, output: 64_000 },
} as unknown as ModelInfo

const messages: Record<string, SessionMessageInfo[]> = { [ROOT]: root.messages, [CHILD]: child.messages }
const titles: Record<string, { title: string; agent?: string }> = {
  [ROOT]: { title: "Dark mode for settings" },
  [CHILD]: { title: "Find the failing snapshot", agent: "explore" },
}
const done = async () => {}

const data = {
  session: {
    message: {
      list: (id: string) => messages[id] ?? [],
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

const session = { id: ROOT, location: {}, server: { data } } as unknown as MountedSession
const mode = new URLSearchParams(location.search).get("mode") === "dark" ? "dark" : "light"
document.body.dataset.mode = mode
document.head.append(Object.assign(document.createElement("style"), { textContent: css }))

render(
  () => (
    <Dashboard
      session={session}
      fallback={() => ""}
      fallbackName={() => undefined}
      chooseFallback={() => {}}
      mode={() => mode}
    />
  ),
  document.getElementById("app")!,
)
