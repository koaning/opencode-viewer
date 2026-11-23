import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// The demo page: the dashboard with a made-up session, for working on the UI (`bun run demo`) and for shooting the
// docs (`bun run screenshot`).
export default defineConfig({
  root: here("."),
  plugins: [solid()],
  resolve: { alias: { "@opencode/plugin/gui": here("./stub.ts") } },
})
