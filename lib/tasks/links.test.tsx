import { describe, it, expect } from "vitest"
import {
  TEMPLATE_LINKS, cleanTaskLink, clientLink, fallbackLink, isSafeTaskLink,
  networkBoardLink, networkImportLink, practiceRoundLink, resolveLinkTemplate,
} from "./links"

describe("what may sit behind a Go button", () => {
  it("accepts a path inside the dashboard", () => {
    expect(isSafeTaskLink("/dashboard/coach/clients/abc")).toBe(true)
    expect(isSafeTaskLink("/dashboard/network?client_profile_id=abc")).toBe(true)
  })

  // The point of the whitelist. A Go button is pressed without reading, on a
  // row SIGNAL vouched for, and task titles carry client-supplied names.
  it("refuses anything that leaves the origin", () => {
    expect(isSafeTaskLink("https://evil.test/login")).toBe(false)
    expect(isSafeTaskLink("http://evil.test")).toBe(false)
    // Protocol-relative: the browser reads this as a full URL, and a naive
    // startsWith("/") lets it through.
    expect(isSafeTaskLink("//evil.test/dashboard/")).toBe(false)
    // Backslashes are normalised to slashes in some positions, so this is
    // another way out of the origin.
    expect(isSafeTaskLink("/dashboard/\\evil.test")).toBe(false)
    expect(isSafeTaskLink("javascript:alert(1)")).toBe(false)
    expect(isSafeTaskLink("data:text/html,<script>")).toBe(false)
  })

  it("refuses a path outside the dashboard, even same-origin", () => {
    expect(isSafeTaskLink("/api/coach/tasks")).toBe(false)
    expect(isSafeTaskLink("/")).toBe(false)
  })

  it("refuses things that are not strings", () => {
    expect(isSafeTaskLink(null)).toBe(false)
    expect(isSafeTaskLink(undefined)).toBe(false)
    expect(isSafeTaskLink(42)).toBe(false)
    expect(isSafeTaskLink({ toString: () => "/dashboard/x" })).toBe(false)
  })
})

describe("cleaning a link", () => {
  it("trims and keeps a good one", () => {
    expect(cleanTaskLink("  /dashboard/coach/tasks  ")).toBe("/dashboard/coach/tasks")
  })

  it("is null for empty, and null for unusable", () => {
    expect(cleanTaskLink("")).toBeNull()
    expect(cleanTaskLink("   ")).toBeNull()
    expect(cleanTaskLink(null)).toBeNull()
    expect(cleanTaskLink(undefined)).toBeNull()
    expect(cleanTaskLink("https://evil.test")).toBeNull()
  })
})

describe("the builders", () => {
  it("point at real screens", () => {
    expect(clientLink("c1")).toBe("/dashboard/coach/clients/c1")
    expect(clientLink("c1", "practice")).toBe("/dashboard/coach/clients/c1?tab=practice")
    expect(networkBoardLink("c1")).toBe("/dashboard/network?client_profile_id=c1")
    expect(networkImportLink("c1")).toBe("/dashboard/network/import?client_profile_id=c1")
    expect(practiceRoundLink("r1")).toBe("/dashboard/coach/practice/r1")
  })

  it("produce links that pass their own safety check", () => {
    for (const l of [clientLink("c1"), clientLink("c1", "practice"), networkBoardLink("c1"),
                     networkImportLink("c1"), practiceRoundLink("r1")]) {
      expect(isSafeTaskLink(l)).toBe(true)
    }
  })

  it("falls back to the client record, or to nothing", () => {
    expect(fallbackLink("c1")).toBe("/dashboard/coach/clients/c1")
    expect(fallbackLink(null)).toBeNull()
    expect(fallbackLink(undefined)).toBeNull()
  })
})

describe("resolving a template pattern", () => {
  it("substitutes the client", () => {
    expect(resolveLinkTemplate("/dashboard/network?client_profile_id={clientId}", { clientId: "c1" }))
      .toBe("/dashboard/network?client_profile_id=c1")
  })

  // The failure that matters: a URL with a literal "{clientId}" in it looks
  // like a link, renders as a Go button, and goes nowhere.
  it("returns null rather than a pattern with an unfilled token", () => {
    expect(resolveLinkTemplate("/dashboard/network?client_profile_id={clientId}", { clientId: null })).toBeNull()
    expect(resolveLinkTemplate("/dashboard/x/{briefId}", { clientId: "c1" })).toBeNull()
  })

  it("is null when there is no pattern at all", () => {
    expect(resolveLinkTemplate(null, { clientId: "c1" })).toBeNull()
    expect(resolveLinkTemplate("", { clientId: "c1" })).toBeNull()
  })

  it("refuses a pattern that resolves to somewhere off-origin", () => {
    expect(resolveLinkTemplate("https://evil.test/{clientId}", { clientId: "c1" })).toBeNull()
  })

  it("escapes the value rather than pasting it in raw", () => {
    const out = resolveLinkTemplate("/dashboard/network?client_profile_id={clientId}", { clientId: "a b&c=d" })
    expect(out).toBe("/dashboard/network?client_profile_id=a%20b%26c%3Dd")
  })
})

describe("the networking chain's destinations", () => {
  it("covers all five templates", () => {
    expect(Object.keys(TEMPLATE_LINKS).sort()).toEqual([
      "networking.create_campaign",
      "networking.define_campaign",
      "networking.review_campaign",
      "networking.share_plan",
      "networking.upload_and_build",
    ])
  })

  // Every pattern must survive resolution, or the task it belongs to is
  // refused at creation and the chain stops.
  it("every pattern resolves to a safe link", () => {
    for (const [key, pattern] of Object.entries(TEMPLATE_LINKS)) {
      const out = resolveLinkTemplate(pattern, { clientId: "c1", briefId: "b1" })
      expect(out, key).not.toBeNull()
      expect(isSafeTaskLink(out!), key).toBe(true)
    }
  })

  it("sends the upload step to the importer and the rest to the board", () => {
    expect(TEMPLATE_LINKS["networking.upload_and_build"]).toContain("/dashboard/network/import")
    for (const k of ["networking.create_campaign", "networking.define_campaign",
                     "networking.review_campaign", "networking.share_plan"]) {
      expect(TEMPLATE_LINKS[k], k).toBe("/dashboard/network?client_profile_id={clientId}")
    }
  })
})
