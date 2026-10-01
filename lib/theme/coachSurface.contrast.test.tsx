// Two contrast fixes on the light coach surface, pinned so a later theme
// change cannot quietly undo them (2026-10-02):
//   1. a featured navy button's label is bright orange, not the near-black
//      meant for peach fills (Convert to Client read black on navy);
//   2. every date picker's calendar icon is navy, not white on white.
// Plus a source scan: no button pairs the navy primary fill with near-black
// ink, which is how the first one shipped.

import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { DATE_PICKER_CSS, LIGHT_COACH_EXTRAS, coachSurfaceCss } from "./coachSurface"

describe("light coach surface contrast", () => {
  it("featured navy buttons get a bright orange label", () => {
    expect(LIGHT_COACH_EXTRAS["ink-on-primary-accent"]).toBe("#FF6B00")
    expect(coachSurfaceCss()).toContain("--sig-ink-on-primary-accent: #FF6B00;")
  })

  it("date pickers use the light scheme and a navy calendar icon", () => {
    const css = coachSurfaceCss()
    expect(css).toContain(DATE_PICKER_CSS)
    expect(DATE_PICKER_CSS).toMatch(/\[data-coach-surface="light"\] input\[type="date"\][^{]*\{\s*color-scheme: light !important;/)
    expect(DATE_PICKER_CSS).toContain('[data-coach-surface="light"] input[type="date"]::-webkit-calendar-picker-indicator')
    expect(DATE_PICKER_CSS).toContain("stroke='%2308203F'") // navy, the light ink
    // The dark island (nav) is never matched.
    expect(DATE_PICKER_CSS).not.toContain('data-coach-surface="dark"')
  })

  it("no screen puts near-black ink on the navy primary fill", () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) { if (name !== "node_modules") walk(full); continue }
        if (!full.endsWith(".tsx") || full.endsWith(".test.tsx")) continue
        const lines = readFileSync(full, "utf8").split(/\r?\n/)
        lines.forEach((l, i) => {
          if (!l.includes("GRAD_PRIMARY")) return
          const near = lines.slice(i, i + 4).join("\n")
          if (/--sig-ink-on-bright/.test(near)) offenders.push(`${full}:${i + 1}`)
        })
      }
    }
    walk(join(process.cwd(), "app", "dashboard"))
    expect(offenders).toEqual([])
  })
})
