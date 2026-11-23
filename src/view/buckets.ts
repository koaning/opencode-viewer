// Categorical slots (validated palette, see style.css). One hue means one thing on every chart of the dashboard:
// blue is you, green the model writing, violet its thinking, amber the arguments it writes for tools, orange tools (their
// results in the context, their time in a turn), red a compaction. Grey is the baseline: the system share, waiting.
export const S = (n: number) => `var(--ocv-s${n})`
export const NEUTRAL = "var(--ocv-neutral)"
export const NEUTRAL_2 = "var(--ocv-neutral-2)"
/** Money is its own axis, so cost bars get one quiet ink rather than a hue that means something else elsewhere. */
export const INK = "var(--ocv-ink)"

/**
 * The family a series belongs to, shared across charts: hovering one lights up the same family everywhere.
 * See `focus.ts`.
 */
export type Family = "system" | "summary" | "user" | "assistant" | "reasoning" | "calls" | "tools" | "waiting" | "cost"

export const TIME = {
  thinking: { key: "reasoning", label: "Thinking", color: S(7) },
  model: { key: "assistant", label: "Generating", color: S(3) },
  tools: { key: "tools", label: "Tools", color: S(2) },
  other: { key: "waiting", label: "Waiting", color: NEUTRAL },
} as const satisfies Record<string, { key: Family; label: string; color: string }>

export const PRODUCED = {
  reasoning: { key: "reasoning", label: "Thinking", color: S(7) },
  text: { key: "assistant", label: "Text", color: S(3) },
  calls: { key: "calls", label: "Tool call args", color: S(4) },
} as const satisfies Record<string, { key: Family; label: string; color: string }>

/** What a request's cost paid for; shown in tooltips, the bars themselves are one ink. */
export const COST = {
  cacheRead: { label: "Cache reads" },
  input: { label: "New input" },
  cacheWrite: { label: "Cache writes" },
  output: { label: "Output + thinking" },
}

export interface Meta {
  readonly label: string
  readonly color: string
  readonly detail?: string
}

/** Every tool's results, together: one orange, like tool time in the turns. The legend and Tools table split them. */
export const TOOLS = "tools"

const FIXED: Record<string, Meta> = {
  system: { label: "System / tools", color: NEUTRAL, detail: "System prompt and tool definitions, measured from the first request" },
  summary: { label: "Compaction summary", color: S(8), detail: "What replaced the history before the last compaction" },
  user: { label: "Your messages", color: S(1), detail: "Prompts, attachments, shell and skill messages" },
  assistant: { label: "Assistant text", color: S(3), detail: "The model's replies" },
  reasoning: { label: "Reasoning", color: S(7), detail: "Thinking the transcript kept" },
  calls: { label: "Tool call inputs", color: S(4), detail: "Arguments the model wrote for its tool calls" },
  [TOOLS]: { label: "Tool results", color: S(2), detail: "What tools returned to the model" },
}
const ORDER = ["system", "summary", "user", "assistant", "reasoning", "calls", TOOLS]

/** The categories of the context, as the composition bar and the timeline show them. */
export interface Palette {
  /** The category a part's key falls in. */
  readonly group: (key: string) => string
  readonly meta: (group: string) => Meta
  /** Categories bottom to top in a stack: the system share as the baseline, then what the conversation adds. */
  readonly order: readonly string[]
}

const group = (key: string) => (key.startsWith("tool:") ? TOOLS : key)
const meta = (g: string): Meta => FIXED[g] ?? { label: g, color: NEUTRAL_2 }

export const paletteOf = (keys: Iterable<string>): Palette => {
  const present = new Set([...keys].map(group))
  return { group, meta, order: ORDER.filter((k) => present.has(k)) }
}

/** A point's parts summed by category. */
export const grouped = (parts: Readonly<Record<string, number>>, palette: Palette): Map<string, number> => {
  const out = new Map<string, number>()
  for (const [key, value] of Object.entries(parts)) {
    const g = palette.group(key)
    out.set(g, (out.get(g) ?? 0) + value)
  }
  return out
}

/** Tool results by tool name, largest first: what the one orange "Tool results" category is made of. */
export const toolParts = (parts: Readonly<Record<string, number>>): [string, number][] =>
  Object.entries(parts)
    .filter(([key, value]) => key.startsWith("tool:") && value >= 1)
    .map(([key, value]): [string, number] => [key.slice(5), value])
    .sort((a, b) => b[1] - a[1])

