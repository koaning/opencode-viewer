# opencode-viewer

A live dashboard of the current OpenCode session, in a tab of OpenCode Desktop's side region, next to the browser.

- **Context**: how much of the model's window the latest request used, as one bar against the whole window, with a
  row per category: the system prompt + tool definitions, your messages, assistant text, reasoning, tool call inputs,
  each tool's results, and the free space left.
- **Overview**: active time split into model and tool time, tokens processed (sent, how much of it was cached, and
  output), cost, and turns, requests and tool calls, subagents included.
- **Every request**: the same breakdown for every request of the session, a column each, so you see *what* the
  context grew with (a big file read, reasoning piling up, a compaction resetting it). A short session gets a few
  columns that grow to the right; a long one packs them in. Below it, on its own scale, what each request produced:
  thinking, text and tool-call arguments. Below that, what each request cost, split into cache reads, new input,
  cache writes and output, so you see that a big but cached context is cheap and a cache miss is not. Hover a request
  to read it out (with its turn's total); click it to open it in its turn.
- **Turns**: one row per prompt, newest first, with its duration split into thinking, generating, tools and waiting.
  Each row opens into its trace: a waterfall after wigglystuff's TraceView, with the turn as the timeline and one row
  per request (a bar for thinking, generating and waiting on tools), notes (compactions, instruction updates) in
  between. Requests hold their tool calls, and subagent (`task`) calls hold the subagent's requests (fold them out
  with `+`). Click a row for its details: tokens and cost, what its context held and what it produced, the thinking
  and text, and a tool's input, output and error. The latest turn is open and follows the session; click any other
  to open it too.
- **Tools**: calls, total and longest time, and estimated output tokens per tool.

It updates while the session runs, and the numbers ease to their new values instead of jumping (off under the OS's
reduced-motion setting). It works for remote (SSH) sessions too: it only reads the session data Desktop already
syncs, so there is no server part.

## How the numbers are made

- **Time**: a request runs from `created` to `streamed` while the model generates, then its tools run until `completed`.
  "Waiting / other" is whatever else is in the turn: queueing, retries, the gaps between requests. Active time adds
  up the turns, so days between turns don't count.
- **Context composition** is an estimate anchored on measurements. Each request's total is its input + cache tokens
  as the provider counted them. The system share is the first request's context (after the start or a compaction)
  minus the little it carried besides. The rest is split by character counts (÷ 4) of what the transcript held
  before that request, then scaled to add up to the total. When that scaling is more than 25% off, the panel says so.
- **Tokens processed** add up every request: the context it sent plus what it generated. Each request resends the
  whole context, so this grows much faster than the context itself (3 requests of 15–18k context are already ~50k).
- **What a request produced**: its output tokens. Reasoning comes from the provider's reasoning count when it gives one.
  The rest is split between text and tool-call arguments by their characters.
- **Cost**: the provider's reported cost when it is non-zero. Otherwise it's tokens × the model's catalog price,
  shown with `≈`. Subscription plans report $0, so the estimate is what the same tokens would cost at list price.
  A request's cost is split by kind (cache reads, new input, cache writes, output + thinking) at the model's catalog
  rates; a reported cost is split the same way and scaled to add up to what was reported.
  For models with no price at all (e.g. Ollama), pick a stand-in with **Price unpriced models…** in the dashboard's
  header, or with the palette's *Dashboard: price unpriced models as…*.

## Install

Requires OpenCode Desktop 2.2.5+.

```sh
bun install && bun run build
```

Add the checkout to the plugins in `~/.config/opencode/opencode.json` and restart OpenCode Desktop:

```jsonc
{
  "plugins": [{ "package": "/path/to/opencode-viewer" }],
}
```

## Use

- The side region's **+** menu → **Session dashboard**
- or `/dashboard` in the composer, or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>D</kbd> (rebind it in Settings → Shortcuts)

## Develop

```sh
bun run dev        # rebuilds the GUI bundle on save
bun run typecheck
bun test           # turn splitting, timing, context breakdown, pricing
```

The logic lives in `src/model.ts` and `src/pricing.ts` (pure, tested). `src/data.ts` connects them to the window's
synced data. The views are in `src/view/`.
