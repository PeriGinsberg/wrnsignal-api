// "A couple things to keep moving" — the dashboard nudges, and where each one
// actually goes.
//
// THE GAP THIS FILLS. dashboardState.test.ts covers which applications and
// contacts get SELECTED as nudges, thoroughly. Nothing covered the rendered
// link, so both application nudges pointed at /dashboard/tracker — the whole
// list — while their own sentences named a specific company. The student read
// "You applied to Acme over two weeks ago", clicked "Show me", and landed on a
// list they then had to search for the job the screen had just picked out.
//
// Every assertion here is about the href, because the selection is already
// proven elsewhere and the href is what was wrong.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
// The page owns its own fetching, so the nudges are exercised through the
// exported Nudges component with a hand-built model, rather than mocking three
// endpoints to assert on an href.
import { Nudges } from "./Nudges"

afterEach(cleanup)

const appNudge = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  company_name: `Co ${id}`,
  job_title: `Role ${id}`,
  application_status: "applied",
  applied_date: "2026-07-01",
  created_at: "2026-07-01T00:00:00Z",
  ...over,
})

const contact = (id: string) => ({
  id,
  first_name: "Dana",
  last_name: "Reed",
  last_action_at: "2026-08-01T00:00:00Z",
})

const model = (over: Record<string, unknown> = {}) =>
  ({ awaiting: [], stale: [], saved: [], ...over }) as any

const hrefs = () => screen.getAllByRole("link").map((a) => a.getAttribute("href"))

describe("nudge links point at the thing they name", () => {
  it("a stale application opens THAT job, not the tracker", () => {
    render(<Nudges model={model({ stale: [appNudge("app-1")] })} />)
    expect(hrefs()).toEqual(["/dashboard/tracker/app-1"])
  })

  it("a saved application opens THAT job, not the tracker", () => {
    render(<Nudges model={model({ saved: [appNudge("app-9", { application_status: "saved" })] })} />)
    expect(hrefs()).toEqual(["/dashboard/tracker/app-9"])
  })

  it("never links to the bare tracker index", () => {
    render(
      <Nudges
        model={model({
          stale: [appNudge("app-1"), appNudge("app-2")],
        })}
      />,
    )
    expect(hrefs()).not.toContain("/dashboard/tracker")
    expect(hrefs()).toEqual(["/dashboard/tracker/app-1", "/dashboard/tracker/app-2"])
  })

  it("each nudge gets its OWN job — two nudges never share a destination", () => {
    render(<Nudges model={model({ stale: [appNudge("app-1"), appNudge("app-2")] })} />)
    const h = hrefs()
    expect(new Set(h).size).toBe(h.length)
  })

  it("a replied contact still opens the contact record, unchanged", () => {
    render(<Nudges model={model({ awaiting: [contact("c-1")] })} />)
    expect(hrefs()).toEqual(["/dashboard/network/contacts/c-1"])
  })

  it("saved nudges only appear when nothing more urgent does", () => {
    // Pre-existing behaviour, pinned because the href change sits inside the
    // branch that implements it: saved is the fallback, not an addition.
    render(
      <Nudges
        model={model({
          stale: [appNudge("app-1")],
          saved: [appNudge("app-9", { application_status: "saved" })],
        })}
      />,
    )
    expect(hrefs()).toEqual(["/dashboard/tracker/app-1"])
  })

  it("shows at most three", () => {
    render(
      <Nudges
        model={model({
          awaiting: [contact("c-1"), contact("c-2")],
          stale: [appNudge("app-1"), appNudge("app-2")],
        })}
      />,
    )
    expect(hrefs().length).toBe(3)
  })
})
