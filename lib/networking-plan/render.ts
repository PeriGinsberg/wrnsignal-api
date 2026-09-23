// lib/networking-plan/render.ts
// Plan content into the approved print template.
//
// The template is the approved design, kept as the designer's own HTML rather
// than rebuilt in code, so a change to the design is an edit to one file and
// not a refactor. This module replaces exactly four things inside it: the
// client's name, the cadence strip, the "how the sequence works" bullets, and
// the touch blocks in the three touch sections. Everything else is fixed copy
// the coach wrote once.
//
// ESCAPING IS NOT OPTIONAL. Every value here came out of a spreadsheet somebody
// else typed. A message containing "<" or "&" would otherwise reshape the page,
// and while this renders to a PDF rather than to a browser, a broken layout in
// a document sent to a client is its own kind of failure.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { PlanContent, Touch } from "./planData"

let cached: string | null = null

/** The template, read once per process. */
export function templateHtml(): string {
  if (cached) return cached
  cached = readFileSync(join(process.cwd(), "lib", "networking-plan", "print-template.html"), "utf8")
  return cached
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** Replace the contents of the <section> whose <h2> carries this number. */
function replaceSectionBody(html: string, num: number, body: string): string {
  const marker = `<span class="num">${num}</span>`
  const at = html.indexOf(marker)
  if (at < 0) return html
  const h2End = html.indexOf("</h2>", at)
  const sectionEnd = html.indexOf("</section>", h2End)
  if (h2End < 0 || sectionEnd < 0) return html
  return html.slice(0, h2End + "</h2>".length) + "\n" + body + "\n  " + html.slice(sectionEnd)
}

/** One touch block, in the template's own markup. */
function touchBlock(t: Touch, opts: { heading: boolean }): string {
  const meta = [
    `<span class="label">${escapeHtml(t.when.split("(")[0].trim())}</span>`,
    // The parenthetical half of a When is the instruction, which the design
    // shows as the second, quieter span.
    t.when.includes("(") ? `<span>${escapeHtml(t.when.slice(t.when.indexOf("(") + 1).replace(/\)\s*$/, "").trim())}</span>` : "",
  ].filter(Boolean).join("")

  const subject = t.subject ? `<span class="subj">Subject: ${escapeHtml(t.subject)}</span>` : ""
  const note = t.howToUse
    ? `\n      <div class="note"><span class="label">Coach note</span><br>${escapeHtml(t.howToUse)}</div>`
    : ""
  const heading = opts.heading ? `\n      <h3>${escapeHtml(`${t.channel} ${t.touch}`.trim())}</h3>` : ""

  return `    <div class="touch">${heading}
      <div class="meta">${meta}</div>
      <div class="msg">${subject}${escapeHtml(t.message)}</div>${note}
    </div>`
}

export function renderPlanHtml(args: { clientName: string; content: PlanContent; template?: string }): string {
  const { clientName, content } = args
  let html = args.template ?? templateHtml()

  // 1. The client's name, in the heading AND in the document title. The title
  // is what a PDF viewer shows in its tab and what Drive indexes, so leaving
  // the designer's example name there would put the wrong client's name on
  // every plan in a way nobody would notice on screen.
  html = html.replace(/<h1>[\s\S]*?<\/h1>/, `<h1>${escapeHtml(clientName)}</h1>`)
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(clientName)}: Networking Plan</title>`)

  // 2. The cadence strip, one stop per distinct day.
  if (content.cadence.length) {
    const stops = content.cadence
      .map((s) => `<div class="stop"><div class="dot"></div><div class="day">${escapeHtml(s.day)}</div><div class="what">${escapeHtml(s.what)}</div></div>`)
      .join("\n    ")
    html = html.replace(
      /<div class="cadence"([^>]*)>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/,
      `<div class="cadence"$1>\n    ${stops}\n  </div>`,
    )
  }

  // 3. Section 1: how the sequence works.
  if (content.notes.length) {
    const items = content.notes.map((n) => `      <li>${escapeHtml(n)}</li>`).join("\n")
    html = replaceSectionBody(html, 1, `    <ul>\n${items}\n    </ul>`)
  }

  // 4. Sections 3, 4 and 5: the touches themselves. A section with no touches
  // keeps the template's own copy rather than rendering an empty shell.
  const sections: [number, Touch[], boolean][] = [
    [3, content.emailTouches, true],
    [4, content.linkedinTouches, true],
    // The after-a-conversation block has no heading per touch in the design.
    [5, content.otherTouches, false],
  ]
  for (const [num, touches, heading] of sections) {
    if (!touches.length) continue
    html = replaceSectionBody(html, num, touches.map((t) => touchBlock(t, { heading })).join("\n"))
  }

  return html
}
