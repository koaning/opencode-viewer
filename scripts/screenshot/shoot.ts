import { fileURLToPath } from "node:url"
import { chromium } from "playwright"
import { createServer } from "vite"

// Renders the dashboard with the made-up session in main.tsx and saves light and dark screenshots to docs/.

const configFile = fileURLToPath(new URL("./vite.config.ts", import.meta.url))
const out = (name: string) => fileURLToPath(new URL(`../../docs/${name}`, import.meta.url))

const server = await createServer({ configFile, server: { port: 0 } })
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
    await page.goto(`${url}?mode=${mode}`)
    await page.waitForSelector(".ocv-root")
    await page.waitForTimeout(500)
    await page.locator("#app").screenshot({ path: out(`screenshot-${mode}.png`) })
    console.log(`wrote docs/screenshot-${mode}.png`)
    await page.close()
  }
} finally {
  await browser.close()
  await server.close()
}
