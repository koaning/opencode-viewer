import { render } from "solid-js/web"
import { Dashboard } from "../src/view/dashboard"
import { replayButton, session } from "./session"

// The docs page's script, inlined into docs/index.html by shoot.ts. The page already shows a pre-rendered snapshot
// (and the dashboard's CSS); this swaps in the live dashboard on the made-up session, so hovers, tooltips, clicks and
// the replay work, with no server and no OpenCode. The theme follows the page's own CSS switch, which restyles the
// dashboard whatever mode it was rendered in, so it always renders as "light".

const app = document.getElementById("app")!
app.replaceChildren()
render(
  () => <Dashboard session={session} fallback={() => ""} fallbackName={() => undefined} chooseFallback={() => {}} mode={() => "light"} />,
  app,
)
document.querySelector(".controls")?.append(replayButton("replay"))
