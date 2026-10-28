import { describe, expect, it } from "vitest"
import { coachJobEmailContent, readyBatches, type QueuedJob } from "./sendCoachJobEmails"

const NOW = new Date("2026-10-28T15:00:00Z")
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()
const job = (id: string, client: string, coach: string, minAgo: number): QueuedJob => ({
  id, application_id: `app-${id}`, client_profile_id: client, coach_profile_id: coach, coach_client_id: "cc", created_at: ago(minAgo),
})

describe("readyBatches", () => {
  it("holds a job until it is 10 minutes old", () => {
    expect(readyBatches([job("a", "c1", "k1", 9)], NOW)).toEqual([])
    expect(readyBatches([job("a", "c1", "k1", 10)], NOW).map((b) => b.map((r) => r.id))).toEqual([["a"]])
  })

  it("sends every job for the pair once the oldest is due, newer ones included, oldest first", () => {
    const b = readyBatches([job("new", "c1", "k1", 1), job("old", "c1", "k1", 12), job("mid", "c1", "k1", 6)], NOW)
    expect(b.map((g) => g.map((r) => r.id))).toEqual([["old", "mid", "new"]])
  })

  it("keeps different clients and different coaches apart", () => {
    const b = readyBatches([job("a", "c1", "k1", 15), job("b", "c2", "k1", 15), job("c", "c1", "k2", 15), job("d", "c1", "k1", 11)], NOW)
    expect(b.map((g) => g.map((r) => r.id).sort()).sort()).toEqual([["a", "d"], ["b"], ["c"]])
  })
})

const base = { clientFirstName: "Sam", coachName: "Erin Lopez", trackerUrl: "https://app.example/dashboard/tracker" }
const J1 = { title: "Analyst", company: "Acme & Co", url: "https://app.example/dashboard/tracker/app-1" }
const J2 = { title: "Associate", company: "Globex", url: "https://app.example/dashboard/tracker/app-2" }
const J3 = { title: "Planner", company: "Initech", url: "https://app.example/dashboard/tracker/app-3" }

describe("coachJobEmailContent", () => {
  it("one job: names the coach, company and title, and links to that job", () => {
    const c = coachJobEmailContent({ ...base, jobs: [J1] })
    expect(c.subject).toBe("Erin Lopez added a job to your tracker: Analyst at Acme & Co")
    expect(c.html).toContain("Analyst at Acme &amp; Co")
    expect(c.html).toContain(`href="${J1.url}"`)
    expect(c.text).toContain(J1.url)
    expect(c.html).toContain("Open it and review it for yourself. Read each bullet and decide if this job fits your search goals.")
    expect(c.text).toContain("Open it and review it for yourself. Read each bullet and decide if this job fits your search goals.")
  })

  it("several jobs: one email that names and links each, plus the tracker", () => {
    const c = coachJobEmailContent({ ...base, jobs: [J1, J2, J3] })
    expect(c.subject).toBe("Erin Lopez added 3 jobs to your tracker: Analyst at Acme & Co and 2 more")
    for (const j of [J1, J2, J3]) {
      expect(c.html).toContain(`href="${j.url}"`)
      expect(c.text).toContain(`${j.title} at ${j.company}: ${j.url}`)
    }
    expect(c.html).toContain(`href="${base.trackerUrl}"`)
    expect(c.html).toContain("Open each one and review it for yourself. Read each bullet and decide if this job fits your search goals.")
    expect(c.text).toContain("Open each one and review it for yourself. Read each bullet and decide if this job fits your search goals.")
  })

  it("escapes names in the HTML and uses no em dashes", () => {
    const c = coachJobEmailContent({ ...base, coachName: "<b>Eve</b>", jobs: [J1, J2] })
    expect(c.html).not.toContain("<b>Eve</b>")
    for (const part of [c.subject, c.html, c.text]) expect(part).not.toContain("—")
  })
})
