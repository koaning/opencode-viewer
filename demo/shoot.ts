import { readFileSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { build, createServer, type Rollup } from "vite"
import { staticPage } from "./static"

// Renders the demo page's bare `?shot` view (the made-up session in session.ts) and writes, to docs/: light and dark
// screenshots for the README, and index.html, the docs page: one self-contained file with the dashboard pre-rendered
// and the live one (docs.tsx) bundled inline.

const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url))
const out = (name: string) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url))
const css = readFileSync(fileURLToPath(new URL("../src/style.css", import.meta.url)), "utf8")

// The docs script as one ES module, kept in memory to inline: a separate file wouldn't load from file://.
const bundled = (await build({
  configFile,
  logLevel: "warn",
  build: { write: false, modulePreload: false, rollupOptions: { input: fileURLToPath(new URL("./docs.tsx", import.meta.url)) } },
})) as Rollup.RollupOutput | Rollup.RollupOutput[]
const entry = [bundled]
  .flat()
  .flatMap((o) => o.output)
  .find((chunk): chunk is Rollup.OutputChunk => chunk.type === "chunk" && chunk.isEntry)
if (!entry) throw new Error("the docs build produced no entry chunk")

// 127.0.0.1, not localhost: another dev server on [::1]:5173 would otherwise answer instead of this one.
const server = await createServer({ configFile, server: { host: "127.0.0.1", port: 0 }, logLevel: "warn" })
await server.listen()
const url = server.resolvedUrls!.local[0]!

const browser = await chromium.launch()
try {
  for (const mode of ["light", "dark"] as const) {
    const page = await browser.newPage({
      viewport: { width: 560, height: 900 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
      colorScheme: mode,
    })
    page.on("pageerror", (error) => console.error(error))
    await page.goto(`${url}?shot&mode=${mode}`)
    await page.waitForSelector(".ocv-root")
    await page.waitForTimeout(500)
    await page.locator("#app").screenshot({ path: out(`screenshot-${mode}.png`) })
    console.log(`wrote docs/screenshot-${mode}.png`)
    if (mode === "light") {
      // The light render; the page's own CSS switches it to dark.
      writeFileSync(out("index.html"), staticPage({ dashboard: await page.locator("#app").innerHTML(), css, script: entry.code }))
      console.log("wrote docs/index.html")
    }
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
