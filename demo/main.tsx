import { createEffect, createRoot, createSignal, For } from "solid-js"
import { render } from "solid-js/web"
import css from "../src/style.css?inline"
import { Dashboard } from "../src/view/dashboard"
import { replayButton, session } from "./session"

// The demo page: the real dashboard on the made-up session, for working on the UI (`bun run demo`). Its bare `?shot`
// view is what `bun run screenshot` shoots for the README and pre-renders into the docs page.

const params = new URLSearchParams(location.search)
const shot = params.has("shot")
if (shot) document.body.classList.add("shot")
document.head.append(Object.assign(document.createElement("style"), { textContent: css }))

// Theme: the URL's ?mode=, else the OS setting, which it then follows.
type Mode = "light" | "dark"
const media = matchMedia("(prefers-color-scheme: dark)")
const [choice, setChoice] = createSignal<Mode | "auto">((params.get("mode") as Mode | null) ?? "auto")
const [system, setSystem] = createSignal<Mode>(media.matches ? "dark" : "light")
media.addEventListener("change", () => setSystem(media.matches ? "dark" : "light"))
const mode = () => {
  const c = choice()
  return c === "auto" ? system() : c
}
createRoot(() => createEffect(() => (document.body.dataset.mode = mode())))

const WIDTHS = [380, 560, 720]
const [width, setWidth] = createSignal(560)
createRoot(() => createEffect(() => document.getElementById("frame")!.style.setProperty("--demo-width", `${width()}px`)))

/** A segmented control rendered into one of the page's `.group` slots. */
function Group<T>(props: { readonly options: readonly T[]; readonly label: (value: T) => string; readonly value: () => T; readonly set: (value: T) => void }) {
  return (
    <For each={props.options}>
      {(option) => (
        <button type="button" aria-pressed={props.value() === option} onClick={() => props.set(option)}>
          {props.label(option)}
        </button>
      )}
    </For>
  )
}

if (!shot) {
  render(
    () => <Group options={["auto", "light", "dark"] as const} label={(m) => m[0]!.toUpperCase() + m.slice(1)} value={choice} set={setChoice} />,
    document.getElementById("mode")!,
  )
  render(() => <Group options={WIDTHS} label={(w) => `${w}px`} value={width} set={setWidth} />, document.getElementById("width")!)

  document.getElementById("replay")!.replaceWith(replayButton("replay"))
}

render(
  () => (
    <Dashboard session={session} fallback={() => ""} fallbackName={() => undefined} chooseFallback={() => {}} mode={mode} />
  ),
  document.getElementById("app")!,
)
