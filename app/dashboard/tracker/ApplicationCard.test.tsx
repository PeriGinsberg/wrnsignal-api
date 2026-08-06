// Component tests for the tracker row's people badge.
//
// SILENCE IS THE DEFAULT AND IT IS THE HARDER THING TO GET RIGHT. On day one
// nearly every application has no linked company, so most of these assert that
// nothing is rendered. A badge that appears on almost nothing is the point:
// the rows carrying it are the ones worth a look.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { ApplicationCard, type Application } from "./ApplicationCard"

const base: Application = {
  id: "app-1",
  company_name: "Globex",
  job_title: "Operations Analyst",
  location: "Chicago",
  application_status: "applied",
  applied_date: "2026-08-12",
  created_at: "2026-08-10T00:00:00.000Z",
  signal_score: 71,
  signal_decision: "Review",
  jobfit_run_id: "run-1",
} as unknown as Application

afterEach(cleanup)

describe("ApplicationCard people badge", () => {
  it("shows the count when there are people at the linked company", () => {
    render(<ApplicationCard application={{ ...base, contact_count: 3 }} />)
    const badge = screen.getByTestId("contact-count")
    expect(badge.textContent).toBe("3")
    expect(badge.getAttribute("title")).toBe("3 people you know here")
  })

  it("says 'person' for one", () => {
    render(<ApplicationCard application={{ ...base, contact_count: 1 }} />)
    expect(screen.getByTestId("contact-count").getAttribute("title")).toBe("1 person you know here")
  })

  it("renders NOTHING when the company has no contacts", () => {
    render(<ApplicationCard application={{ ...base, contact_count: 0 }} />)
    expect(screen.queryByTestId("contact-count")).toBeNull()
  })

  it("renders NOTHING when the application has no linked company", () => {
    // contact_count absent entirely, which is what an older client or a row
    // fetched before this shipped looks like.
    render(<ApplicationCard application={base} />)
    expect(screen.queryByTestId("contact-count")).toBeNull()
  })

  it("is not a link or a button: the row already opens the application", () => {
    render(<ApplicationCard application={{ ...base, contact_count: 3 }} />)
    const badge = screen.getByTestId("contact-count")
    expect(badge.querySelector("a")).toBeNull()
    expect(badge.querySelector("button")).toBeNull()
    expect(badge.tagName).toBe("SPAN")
  })

  it("does not disturb the score or the status beside it", () => {
    render(<ApplicationCard application={{ ...base, contact_count: 2 }} />)
    expect(screen.getByText("71")).toBeTruthy()
    expect(screen.getByText("Applied")).toBeTruthy()
  })
})
