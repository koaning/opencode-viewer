import { Plugin } from "@opencode/plugin/gui"

export const definition = Plugin.define({
  i18n: {
    en: {
      "panel.title": "Dashboard",
      "menu.title": "Session dashboard",
      "menu.description": "Turns, time, context and tokens",
      "command.toggle": "Toggle session dashboard",
      "command.fallback": "Dashboard: price unpriced models as…",
      "fallback.title": "Price unpriced models as",
      "fallback.placeholder": "Search priced models",
      "fallback.none": "Don't estimate unpriced models",
      "fallback.group": "Priced models",
      nosession: "Open a session to see its dashboard",
    },
  },
})
