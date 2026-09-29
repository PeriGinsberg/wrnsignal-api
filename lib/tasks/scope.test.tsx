import { describe, it, expect } from "vitest"
import { taskIsReachable, taskReachFilter, type TaskReach } from "./scope"

const ME = "coach-me"
const PRINCIPAL = "coach-principal"
const STRANGER = "coach-stranger"
const MY_CLIENT = "client-mine"
const THEIR_CLIENT = "client-theirs"
const MY_CC = "cc-mine"

const reach: TaskReach = {
  actingIds: [ME, PRINCIPAL],
  clientIds: [MY_CLIENT],
  coachClientIds: [MY_CC],
}

const task = (over: Partial<Parameters<typeof taskIsReachable>[1]> = {}) => ({
  client_profile_id: null,
  coach_client_id: null,
  assignee_profile_id: ME,
  ...over,
})

describe("which tasks a coach may reach", () => {
  it("reaches a task for a client in their book", () => {
    expect(taskIsReachable(reach, task({ client_profile_id: MY_CLIENT }))).toBe(true)
  })

  // THE BUG. A task for a client this coach has no relationship with sat in
  // their queue with a Go button that returned Forbidden.
  it("does not reach a task for somebody else's client", () => {
    expect(taskIsReachable(reach, task({ client_profile_id: THEIR_CLIENT }))).toBe(false)
  })

  // And not even when it is addressed to them. Assignment is not access: the
  // page the Go button opens checks the relationship, so this must too, or the
  // product is handing out work it will not let anyone do.
  it("does not reach somebody else's client even when assigned to them", () => {
    expect(taskIsReachable(reach, task({
      client_profile_id: THEIR_CLIENT,
      assignee_profile_id: ME,
    }))).toBe(false)
  })

  it("reaches a prospect-era task by its relationship, with no client on it", () => {
    expect(taskIsReachable(reach, task({ coach_client_id: MY_CC }))).toBe(true)
    expect(taskIsReachable(reach, task({ coach_client_id: "cc-theirs" }))).toBe(false)
  })

  it("reaches a task with no client when it is their own", () => {
    expect(taskIsReachable(reach, task({ assignee_profile_id: ME }))).toBe(true)
    expect(taskIsReachable(reach, task({ assignee_profile_id: PRINCIPAL }))).toBe(true)
    expect(taskIsReachable(reach, task({ assignee_profile_id: STRANGER }))).toBe(false)
  })

  it("gives a coach with an empty book nothing but their own clientless tasks", () => {
    const empty: TaskReach = { actingIds: [ME], clientIds: [], coachClientIds: [] }
    expect(taskIsReachable(empty, task({ client_profile_id: MY_CLIENT }))).toBe(false)
    expect(taskIsReachable(empty, task({ assignee_profile_id: ME }))).toBe(true)
  })
})

describe("the filter sent to PostgREST", () => {
  it("names the caller's clients, relationships and own clientless tasks", () => {
    const f = taskReachFilter(reach)
    expect(f).toContain(`client_profile_id.in.(${MY_CLIENT})`)
    expect(f).toContain(`coach_client_id.in.(${MY_CC})`)
    expect(f).toContain("and(client_profile_id.is.null,coach_client_id.is.null,")
    expect(f).toContain(`assignee_profile_id.in.(${ME},${PRINCIPAL})`)
  })

  // An empty book must not produce `client_profile_id.in.()`, which PostgREST
  // rejects and which would 500 the whole list rather than returning nothing.
  it("omits an empty set rather than emitting an empty in() list", () => {
    const f = taskReachFilter({ actingIds: [ME], clientIds: [], coachClientIds: [] })
    expect(f).not.toContain("in.()")
    expect(f).toContain("and(client_profile_id.is.null")
  })

  // The clientless branch is always present, so the expression can never be
  // empty. `or=()` is a syntax error and would take the list down.
  it("is never empty", () => {
    expect(taskReachFilter({ actingIds: [], clientIds: [], coachClientIds: [] }).length)
      .toBeGreaterThan(0)
  })
})
