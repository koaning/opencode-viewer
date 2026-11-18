import { Plugin } from "@opencode/plugin/gui"
import { definition } from "./definition"
import { setup } from "./window"

// Window-only: everything the dashboard shows is already in each window's synced session data.
export default Plugin.define({ ...definition, setup })
