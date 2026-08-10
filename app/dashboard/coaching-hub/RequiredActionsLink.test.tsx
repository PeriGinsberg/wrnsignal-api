// Where a Required Action sends the client.
//
// It used to be /dashboard/tracker?job={id}, which the tracker then
// client-side redirected to /dashboard/tracker/{id} — the same one-hop
// indirection removed from the Dashboard nudges. The card names a specific job;
// the link should open it, not the list, and not the list-then-the-job.

import { describe, it, expect, vi, afterEach } from "vitest"
import { unreviewedSourcedJobs } from "./page"

const REC = {
  id: "rec-1",
  client_status: "new",
  application_id: "app-7",
  job_title: "Senior PM",
  company_name: "Globex",
  coaching_note: "Worth a look",
  signal_decision: "Apply",
  signal_score: 82,
  created_at: "2026-08-01T00:00:00Z",
}

function mockRecs(recs: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(() =>
    Promise.resolve({ ok: true, json: async () => ({ ok: true, recommendations: recs }) } as Response),
  ))
}

afterEach(() => vi.unstubAllGlobals())

describe("required action destination", () => {
  it("links straight to the job, not the tracker index", async () => {
    mockRecs([REC])
    const [item] = await unreviewedSourcedJobs.load({ token: "t", groups: [] })
    expect(item.href).toBe("/dashboard/tracker/app-7")
  })

  it("never emits a ?job= query link", async () => {
    mockRecs([REC])
    const items = await unreviewedSourcedJobs.load({ token: "t", groups: [] })
    for (const i of items) expect(i.href).not.toContain("?job=")
  })

  it("still skips answered recommendations and unlinked ones", async () => {
    mockRecs([
      REC,
      { ...REC, id: "rec-2", client_status: "interested" },
      { ...REC, id: "rec-3", application_id: null },
    ])
    const items = await unreviewedSourcedJobs.load({ token: "t", groups: [] })
    expect(items.map((i) => i.id)).toEqual(["rec-1"])
  })
})
