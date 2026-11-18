import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// Serves the dashboard with a made-up session, for `bun run screenshot`.
export default defineConfig({
  root: here("."),
  plugins: [solid()],
  resolve: { alias: { "@opencode/plugin/gui": here("./stub.ts") } },
  logLevel: "warn",
})
