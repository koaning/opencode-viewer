import { describe, expect, test } from "bun:test"
import { childrenOf, contextBreakdown, contextTimeline, producedOf, toolStats, totalsOf, turnsOf } from "../src/model"
import { compaction, step, system, user } from "./fixtures"

const x = (n: number) => "x".repeat(n)

describe("turnsOf", () => {
  test("splits at user messages and times model and tools apart", () => {
    const messages = [
      user(1000, "first"),
      step({
        created: 1100,
        streamed: 1600,
        completed: 2600,
        tokens: { input: 100, output: 10 },
        tools: [{ name: "bash", created: 1500, ran: 1600, completed: 2600, input: { command: "ls -la" }, output: "a\nb" }],
      }),
      step({ created: 2600, streamed: 3000, completed: 3000, tokens: { input: 10, output: 20, read: 100 }, text: "done" }),
      user(5000, "second"),
      step({ created: 5050, streamed: 5500, completed: 5500, tokens: { input: 5, output: 5, read: 200 } }),
    ]
    const turns = turnsOf(messages, { now: 9999 })
    expect(turns).toHaveLength(2)
    const [a, b] = turns
    expect(a!.prompt).toBe("first")
    expect(a!.steps).toHaveLength(2)
    expect(a!.ms).toBe(2000)
    expect(a!.modelMs).toBe(500 + 400)
    expect(a!.toolMs).toBe(1000)
    expect(a!.otherMs).toBe(100)
    expect(a!.toolCalls).toBe(1)
    expect(a!.peakContext).toBe(110)
    expect(a!.steps[0]!.tools[0]).toMatchObject({ name: "bash", summary: "ls -la", ms: 1000, outputChars: 3 })
    expect(b!.usage).toEqual({ input: 5, output: 5, reasoning: 0, cacheRead: 200, cacheWrite: 0 })

    const totals = totalsOf(turns)
    expect(totals).toMatchObject({ turns: 2, steps: 3, toolCalls: 1, wallMs: 4500, toolMs: 1000 })
  })

  test("times older transcripts without streamed or ran from their tool calls", () => {
    const [turn] = turnsOf(
      [
        user(0, "go"),
        step({ created: 100, completed: 2000, tokens: { input: 1, output: 1 }, tools: [{ name: "task", created: 500, completed: 1900 }] }),
      ],
      { now: 0 },
    )
    expect(turn!.modelMs).toBe(400)
    expect(turn!.toolMs).toBe(1500)
    expect(turn!.steps[0]!.tools[0]!.ms).toBe(1400)
  })

  test("only a busy session's last step is still running", () => {
    const messages = [user(0, "go"), step({ created: 100, streamed: 300, tokens: { input: 1, output: 1 } })]
    const live = turnsOf(messages, { now: 5000, running: true })[0]!
    expect(live.running).toBe(true)
    expect(live.steps[0]!.running).toBe(true)
    expect(live.ms).toBe(5000)
    const idle = turnsOf(messages, { now: 5000 })[0]!
    expect(idle.running).toBe(false)
    expect(idle.ms).toBe(300)
  })

  test("activity before the first prompt is turn 0, and markers are kept", () => {
    const turns = turnsOf([step({ created: 0, completed: 10 }), compaction(20, "sum"), user(30, "hi")], { now: 0 })
    expect(turns).toHaveLength(2)
    expect(turns[0]!.prompt).toBe("")
    expect(turns[0]!.markers[0]!.kind).toBe("compaction")
    expect(turns[0]!.usage.input).toBe(1000)
    expect(totalsOf(turns).turns).toBe(1)
  })

  test("a note filed just before a prompt goes with that prompt, not the idle turn before it", () => {
    const turns = turnsOf(
      [
        user(0, "yo"),
        step({ created: 10, completed: 2000 }),
        system(37_000, "The tool catalog has changed"),
        user(37_001, "next"),
        step({ created: 37_010, completed: 40_000 }),
      ],
      { now: 0 },
    )
    expect(turns[0]!.ms).toBe(2000)
    expect(turns[0]!.markers).toHaveLength(0)
    expect(turns[1]!.markers.map((m) => m.kind)).toEqual(["system"])
  })

  test("a note between steps stays in its turn", () => {
    const turns = turnsOf(
      [user(0, "go"), step({ created: 10, completed: 100 }), system(150, "note"), step({ created: 200, completed: 300 })],
      { now: 0 },
    )
    expect(turns).toHaveLength(1)
    expect(turns[0]!.markers).toHaveLength(1)
    expect(turns[0]!.ms).toBe(300)
  })

  test("finds subagent sessions on task calls", () => {
    const turns = turnsOf(
      [user(0, "go"), step({ created: 1, completed: 9, tools: [{ name: "task", created: 2, completed: 8, child: "ses_child" }] })],
      { now: 0 },
    )
    expect(childrenOf(turns)).toEqual(["ses_child"])
  })
})

describe("contextBreakdown", () => {
  test("anchors the system share on the first request and adds up to the measured total", () => {
    const messages = [
      user(0, x(400)), // ~100 tokens
      step({
        created: 1,
        completed: 2,
        tokens: { input: 5100, output: 10 }, // 5000 system + 100 prompt
        text: x(400),
        tools: [{ name: "read", created: 1, completed: 2, input: { filePath: "a" }, output: x(8000) }],
      }),
      step({ created: 3, completed: 4, tokens: { input: 300, output: 10, read: 7000 } }),
    ]
    const breakdown = contextBreakdown(messages)!
    expect(breakdown.total).toBe(7300)
    const system = breakdown.shares.find((s) => s.bucket.kind === "system")!
    expect(system.tokens).toBe(5000)
    const sum = breakdown.shares.reduce((acc, s) => acc + s.tokens, 0)
    expect(Math.abs(sum - breakdown.total)).toBeLessThanOrEqual(breakdown.shares.length)
    const read = breakdown.shares.find((s) => s.bucket.kind === "tool" && s.bucket.name === "read")!
    expect(read.tokens).toBeGreaterThan(1500)
    expect(breakdown.shares.every((s) => s.tokens >= 0)).toBe(true)
  })

  test("starts over after a compaction, from its summary", () => {
    const messages = [
      user(0, x(40000)),
      step({ created: 1, completed: 2, tokens: { input: 20000, output: 10 } }),
      compaction(3, x(2000)),
      user(4, x(400)),
      step({ created: 5, completed: 6, tokens: { input: 5600, output: 10 } }),
    ]
    const breakdown = contextBreakdown(messages)!
    expect(breakdown.total).toBe(5600)
    expect(breakdown.shares.find((s) => s.bucket.kind === "system")!.tokens).toBe(5000)
    expect(breakdown.shares.find((s) => s.bucket.kind === "summary")!.tokens).toBeGreaterThan(0)
  })

  test("is undefined before any request reports tokens", () => {
    expect(contextBreakdown([user(0, "hi")])).toBeUndefined()
  })
})

describe("contextTimeline", () => {
  test("gives every request its makeup, adding up to its measured context", () => {
    const messages = [
      user(0, x(400)),
      step({
        created: 1,
        completed: 2,
        tokens: { input: 5100, output: 50 },
        text: x(40),
        tools: [{ name: "bash", created: 1, completed: 2, input: { command: "ls" }, output: x(4000) }],
      }),
      user(3, x(40)),
      step({ created: 4, completed: 5, tokens: { input: 200, output: 10, read: 6000 }, reasoning: x(80) }),
    ]
    const { points, compactions } = contextTimeline(messages)
    expect(compactions).toEqual([])
    expect(points.map((p) => [p.turn, p.total])).toEqual([
      [0, 5100],
      [1, 6200],
    ])
    for (const point of points) {
      const sum = Object.values(point.parts).reduce((a, b) => a + b, 0)
      expect(sum).toBeCloseTo(point.total, 5)
    }
    // The first request held the system share and the prompt; bash's output only shows up in the next one.
    expect(points[0]!.parts.system).toBe(5000)
    expect(points[0]!.parts["tool:bash"]).toBeUndefined()
    expect(points[1]!.parts.system).toBe(5000)
    expect(points[1]!.parts["tool:bash"]).toBeGreaterThan(900)
    // What the first request produced: its text and the bash call's arguments.
    expect(points[0]!.produced.reasoning).toBe(0)
    expect(points[0]!.produced.text + points[0]!.produced.calls).toBeCloseTo(50, 5)
    expect(points[1]!.produced.reasoning).toBe(10)
  })

  test("starts over at a compaction and marks where", () => {
    const { points, compactions } = contextTimeline([
      user(0, "a"),
      step({ created: 1, completed: 2, tokens: { input: 100, output: 1 } }),
      compaction(3, x(400)),
      user(4, x(40)),
      step({ created: 5, completed: 6, tokens: { input: 5000, output: 1 } }),
      step({ created: 7, completed: 8, tokens: { input: 5200, output: 1 } }),
    ])
    expect(points).toHaveLength(3)
    expect(compactions).toEqual([1])
    // The system share is measured again after the compaction, net of the summary and the prompt.
    expect(points[1]!.parts.system).toBe(5000 - 100 - 10)
    expect(points[2]!.parts.summary).toBeGreaterThan(0)
  })

  test("numbers turns as turnsOf does, activity before the first prompt being turn 0", () => {
    const messages = [step({ created: 0, completed: 1, tokens: { input: 10, output: 1 } }), user(2, "hi"), step({ created: 3, completed: 4, tokens: { input: 20, output: 1 } })]
    expect(contextTimeline(messages).points.map((p) => p.turn)).toEqual(turnsOf(messages, { now: 0 }).flatMap((t) => t.steps.map(() => t.index)))
  })
})

test("producedOf splits output by what it went to", () => {
  expect(producedOf({ output: 100, reasoning: 40, reasoningChars: 999, textChars: 300, callChars: 100 })).toEqual({ reasoning: 40, text: 75, calls: 25 })
  expect(producedOf({ output: 100, reasoning: 0, reasoningChars: 100, textChars: 100, callChars: 200 })).toEqual({ reasoning: 25, text: 25, calls: 50 })
  expect(producedOf({ output: 10, reasoning: 0, reasoningChars: 0, textChars: 0, callChars: 0 })).toEqual({ reasoning: 0, text: 10, calls: 0 })
})

test("toolStats sums calls, time, errors and output per tool", () => {
  const turns = turnsOf(
    [
      user(0, "go"),
      step({
        created: 0,
        completed: 100,
        tools: [
          { name: "bash", created: 0, ran: 10, completed: 40, output: x(400) },
          { name: "bash", created: 0, ran: 10, completed: 90, error: "boom" },
          { name: "read", created: 0, ran: 1, completed: 2, output: x(40) },
        ],
      }),
    ],
    { now: 0 },
  )
  const stats = toolStats(turns)
  expect(stats.find((s) => s.name === "bash")).toEqual({ name: "bash", calls: 2, errors: 1, ms: 110, maxMs: 80, outputTokens: 100 })
  expect(stats.find((s) => s.name === "read")!.outputTokens).toBe(10)
})
