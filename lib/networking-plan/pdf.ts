// lib/networking-plan/pdf.ts
// HTML to PDF with headless Chromium.
//
// Two environments, one function. On Vercel the browser is @sparticuz/chromium,
// a Linux build packaged for serverless; on a developer's machine that binary
// cannot run, so we drive the Chrome or Edge already installed there. Without
// this branch the feature is untestable locally, which is the fastest way to
// end up debugging a PDF renderer in production.
//
// The page is given the HTML directly rather than a URL: the template is
// self-contained (fonts are inlined as data URIs) so there is nothing to fetch,
// and a renderer that cannot reach the network cannot be slow or flaky because
// of it.

import { existsSync } from "node:fs"

const LOCAL_CHROME = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]

function localBrowser(): string | null {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  return LOCAL_CHROME.find((p) => existsSync(p)) ?? null
}

/**
 * Render a full HTML document to a PDF buffer.
 *
 * `printBackground` is on because the design uses colour blocks; without it the
 * plan prints as white boxes and looks broken rather than plain. Margins come
 * from the template's own @page rule, so they stay with the design.
 */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const isServerless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.VERCEL)
  const puppeteer = (await import("puppeteer-core")).default

  let launchOptions: Record<string, unknown>
  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default
    launchOptions = {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    }
  } else {
    const path = localBrowser()
    if (!path) {
      throw new Error(
        "No local Chrome or Edge found for PDF rendering. Set CHROME_PATH to a Chrome/Edge executable.",
      )
    }
    launchOptions = { executablePath: path, headless: true, args: ["--no-sandbox"] }
  }

  const browser = await puppeteer.launch(launchOptions as any)
  try {
    const page = await browser.newPage()
    // `load` rather than `networkidle`: nothing is fetched, so waiting for the
    // network to go quiet would just add a timeout to every render.
    await page.setContent(html, { waitUntil: "load" })
    // Fonts are data URIs and therefore already present, but the browser still
    // needs a tick to apply them; without this the first page can render in a
    // fallback face.
    await page.evaluateHandle("document.fonts.ready")
    const pdf = await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}
