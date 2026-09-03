import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { subjectId, withSubject, authFetch } from "./authFetch"

// SUBJECT THREADING, which is the load-bearing half of coach access.
//
// A coach reaches a client's networking board at
// /dashboard/network?client_profile_id=<id>, and every route under
// /api/network/ takes that same parameter as its subject. Losing it does not
// produce an error: the routes fall back to the caller's own board, so the
// coach silently reads and WRITES their own roster while looking at a page
// titled with the client's contacts. That is the failure this file exists for.
//
// The param is read off window.location rather than threaded as a prop through
// ~20 call sites, because a forgotten prop is exactly the silent failure above.
// These tests pin both halves of the gate.

vi.mock("../../../lib/supabase-browser", () => ({
  getSupabaseBrowser: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
  }),
}))

const CLIENT = "11111111-2222-3333-4444-555555555555"

function at(pathname: string, search = "") {
  window.history.replaceState({}, "", pathname + search)
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

const calledUrl = () => String(fetchMock.mock.calls[0][0])

describe("subjectId", () => {
  it("is null on the viewer's own board", () => {
    at("/dashboard/network")
    expect(subjectId()).toBeNull()
  })

  it("is the client id when a coach is viewing a client's board", () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    expect(subjectId()).toBe(CLIENT)
  })
})

describe("withSubject", () => {
  it("leaves hrefs alone on the viewer's own board", () => {
    at("/dashboard/network")
    expect(withSubject("/dashboard/network/contacts/c1")).toBe("/dashboard/network/contacts/c1")
  })

  it("carries the subject into a link with no query string", () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    expect(withSubject("/dashboard/network/contacts/c1"))
      .toBe(`/dashboard/network/contacts/c1?client_profile_id=${CLIENT}`)
  })

  it("appends rather than replacing an existing query string", () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    expect(withSubject("/dashboard/network/contacts?stage=identified"))
      .toBe(`/dashboard/network/contacts?stage=identified&client_profile_id=${CLIENT}`)
  })

  // readBackTarget() replays a stored URL that already carries the param, and a
  // duplicated query key would then be resolved by the server rather than here.
  it("is idempotent, because stored back-targets already carry the param", () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    const once = withSubject("/dashboard/network/contacts")
    expect(withSubject(once)).toBe(once)
  })
})

describe("authFetch", () => {
  it("adds the subject to a network API call from a networking page", async () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    await authFetch("/api/network/contacts")
    expect(calledUrl()).toBe(`/api/network/contacts?client_profile_id=${CLIENT}`)
  })

  it("adds nothing on the viewer's own board", async () => {
    at("/dashboard/network")
    await authFetch("/api/network/contacts")
    expect(calledUrl()).toBe("/api/network/contacts")
  })

  // THE FIRST HALF OF THE GATE. authFetch is not network-local: the tracker and
  // profile trees import it too. Appending on the strength of the page alone
  // would push client_profile_id into /api/tracker/* and /api/profile, which is
  // a different feature nothing here has tested.
  it("leaves non-network APIs alone even on a networking page", async () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    await authFetch("/api/profile")
    expect(calledUrl()).toBe("/api/profile")
  })

  // THE SECOND HALF. A coach's tracker view can carry a client_profile_id of
  // its own; the network calls made from that page must keep behaving as they
  // do today rather than silently picking up a new meaning.
  it("leaves network APIs alone when the page is not a networking page", async () => {
    at("/dashboard/tracker", `?client_profile_id=${CLIENT}`)
    await authFetch("/api/network/companies")
    expect(calledUrl()).toBe("/api/network/companies")
  })

  it("never doubles a param a caller already spelled out", async () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    await authFetch(`/api/network/contacts?client_profile_id=${CLIENT}`)
    expect(calledUrl()).toBe(`/api/network/contacts?client_profile_id=${CLIENT}`)
  })

  it("still sends the bearer token", async () => {
    at("/dashboard/network", `?client_profile_id=${CLIENT}`)
    await authFetch("/api/network/contacts")
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok")
  })
})
