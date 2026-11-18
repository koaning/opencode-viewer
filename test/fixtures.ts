import type { SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"

// Small synthetic transcripts in the shape `data.session.message.list` returns.

let n = 0
const id = (prefix: string) => `${prefix}_${++n}`

export const user = (created: number, text: string): SessionMessageInfo => ({ id: id("msg"), type: "user", time: { created }, text })

export interface StepInput {
  created: number
  streamed?: number
  completed?: number
  tokens?: { input: number; output: number; reasoning?: number; read?: number; write?: number }
  cost?: number
  text?: string
  reasoning?: string
  model?: string
  tools?: Array<{
    name: string
    created: number
    ran?: number
    completed?: number
    input?: Record<string, string>
    output?: string
    error?: string
    child?: string
  }>
}

export const step = (s: StepInput): SessionMessageInfo => ({
  id: id("msg"),
  type: "assistant",
  agent: "build",
  model: { id: s.model ?? "m1", providerID: "p" },
  time: { created: s.created, streamed: s.streamed, completed: s.completed },
  finish: s.tools?.length ? "tool-calls" : "stop",
  cost: s.cost ?? 0,
  tokens: s.tokens && {
    input: s.tokens.input,
    output: s.tokens.output,
    reasoning: s.tokens.reasoning ?? 0,
    cache: { read: s.tokens.read ?? 0, write: s.tokens.write ?? 0 },
  },
  content: <SessionMessageAssistant["content"]>[
    ...(s.reasoning ? [{ type: "reasoning" as const, text: s.reasoning, time: { created: s.created + 10 } }] : []),
    ...(s.text ? [{ type: "text" as const, text: s.text }] : []),
    ...(s.tools ?? []).map((t) => ({
      type: "tool" as const,
      id: id("call"),
      name: t.name,
      time: { created: t.created, ran: t.ran, completed: t.completed },
      state: (t.error
        ? { status: "error" as const, input: t.input ?? {}, error: { type: "x", message: t.error } }
        : t.completed === undefined
          ? { status: "running" as const, input: t.input ?? {}, metadata: {} }
          : {
              status: "completed" as const,
              input: t.input ?? {},
              content: [{ type: "text" as const, text: t.output ?? "" }] as [{ type: "text"; text: string }],
              metadata: t.child ? { sessionId: t.child } : {},
            }) as SessionMessageAssistantTool["state"],
    })),
  ],
})

export const compaction = (created: number, summary: string): SessionMessageInfo => ({
  id: id("msg"),
  type: "compaction",
  time: { created },
  status: "completed",
  reason: "auto",
  summary,
  tokens: { input: 1000, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
})

export const system = (created: number, text: string): SessionMessageInfo =>
  ({ id: id("msg"), type: "system", time: { created }, text }) as SessionMessageInfo
