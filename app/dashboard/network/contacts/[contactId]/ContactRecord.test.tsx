// The restructured contact record.
//
// The old screen stacked ten sections and put the thing the user came to do at
// the bottom. These tests pin the new shape: the action box is first and carries
// the message, the frequent stage moves are one tap, the terminal ones are not,
// and the reference sections say what is inside them while shut.
//
// They also pin the promise the restructure was built on — NOTHING WAS REMOVED.
// Every capability the old page had is asserted reachable here.

import { Suspense } from "react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react"
import { displayName } from "../../templates/templateNames"
import ContactRecordPage from "./page"
import { DEFAULTS_BY_ID } from "../../../../../lib/network-tracker/templates"

const authFetchMock = vi.fn()
vi.mock("../../authFetch", () => ({
  authFetch: (...a: unknown[]) => authFetchMock(...a),
  getToken: async () => "t",
}))

const writeText = vi.fn((_t: string) => Promise.resolve())
Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })

const PROFILE = {
  client_first: "Jordan", current_role_title: "Senior Marketing Analyst",
  current_employer: "Northbrook Consumer Group", target_role: "Marketing Analytics",
  target_field: "Marketing", city: "Chicago", school: "University of Illinois",
  key_strength: "turning messy data into decisions",
}

const BASE = {
  id: "c1", first_name: "Priya", last_name: "Nandal", title: "Head of Research",
  email: "priya@nodal.example", linkedin_url: null,
  stage: "sequence_active", outcome_type: null, relationship: "cold", priority: "A",
  segment: "Derivatives", additional_info: null,
  next_due_at: "2026-08-01T00:00:00Z", next_due_reason: "touch_2",
  reminder_override: null, notes: null,
  network_companies: { name: "Nodal Exchange" },
}

let contact: Record<string, unknown> = { ...BASE }
let actions: Array<Record<string, unknown>> = []

function api() {
  return (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    if (u === "/api/network/templates") {
      return json({
        ok: true,
        templates: Object.values(DEFAULTS_BY_ID).map((d) => ({
          template_id: d.id, label: d.label, body: d.body, source: "default",
        })),
      })
    }
    if (u === "/api/network/profile") return json({ ok: true, profile: PROFILE })
    if (u.includes("/stage") || u.includes("/actions") || u.includes("/reminder")) return json({ ok: true })
    if (u === "/api/network/contacts/c1" && init?.method === "PATCH") return json({ ok: true })
    return json({ ok: true, contact, actions })
  }
}
const json = (v: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => v } as unknown as Response)

// A PRE-FULFILLED thenable, not a bare promise. React's use() unwraps a thenable
// carrying status/value synchronously — the exact shape it stamps onto a promise
// once resolved — so the page never suspends. A plain Promise.resolve() suspends
// on first mount and, under jsdom, the fallback never came back down: only the
// first test in the file failed, every later one passing off React's cache.
const params = Object.assign(Promise.resolve({ contactId: "c1" }), {
  status: "fulfilled", value: { contactId: "c1" },
}) as Promise<{ contactId: string }>
const bodyOf = (m: number) => JSON.parse(authFetchMock.mock.calls[m][1].body)

afterEach(cleanup)
beforeEach(() => {
  contact = { ...BASE }
  actions = []
  authFetchMock.mockReset()
  writeText.mockClear()
  authFetchMock.mockImplementation(api())
})

async function open() {
  // Suspense boundary because the page reads its params with use(). Next wraps
  // every page in one; without it here the FIRST mount throws on the suspend and
  // only later tests pass, off React's cached promise.
  const utils = render(<Suspense fallback={null}><ContactRecordPage params={params} /></Suspense>)
  // Wait for the SendPanel's own fetches too, not just the page's. Returning at
  // the action box alone lands mid-"Loading templates…", so every assertion
  // about the message would race the render rather than test it.
  await waitFor(() => expect(screen.queryByTestId("action-box")).toBeTruthy())
  await waitFor(() => expect(screen.queryByText(/Loading templates/)).toBeNull())
  return utils
}

describe("the action box is the screen", () => {
  it("renders the suggested template, filled in, above everything else", async () => {
    await open()
    // 8c chose C2 from relationship=cold + next_due_reason=touch_2; 8b filled it.
    const msg = (screen.getByTestId("rendered-message") as HTMLTextAreaElement).value
    expect(msg).toContain("Priya")
    expect(msg).not.toMatch(/\[NAME\]/)

    // It comes FIRST. The old screen had this at the bottom under four text areas.
    const main = screen.getByTestId("action-box").closest("main")!
    const order = Array.from(main.querySelectorAll('[data-testid]')).map((e) => e.getAttribute("data-testid"))
    expect(order.indexOf("action-box")).toBeLessThan(order.indexOf("drawer-details"))
    expect(order.indexOf("action-box")).toBeLessThan(order.indexOf("reminder-line"))
  })

  it("copy and mark as sent still copies first and logs the due reason's action", async () => {
    await open()
    fireEvent.click(screen.getByRole("button", { name: /Copy and mark as sent/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    const log = authFetchMock.mock.calls.find((c) => String(c[0]).includes("/actions"))
    expect(JSON.parse(log![1].body).type).toBe("touch_2")
  })

  it("keeps the per-contact scratchpad — an edit is what gets copied", async () => {
    await open()
    const box = screen.getByTestId("rendered-message") as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "hand-written for Priya" } })
    fireEvent.click(screen.getByRole("button", { name: /Copy only/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("hand-written for Priya"))
  })
})

describe("the first send — a contact nobody has contacted yet", () => {
  // The bug the redesign could not ship with. `identified` has no due reason
  // (the engine schedules nothing there), so on the old derivation the action
  // box showed "Nothing due" with no primary button: the screen built for
  // sending could not send the first message without a manual stage move first.
  const NOT_CONTACTED = {
    ...BASE, stage: "identified", next_due_at: null, next_due_reason: null,
  }

  it("shows the first-outreach template with a LIVE send button", async () => {
    contact = { ...NOT_CONTACTED }
    await open()

    // pickTemplate falls to touch 1 for the relationship — C1 for a cold contact.
    expect(screen.getByTestId("active-template").textContent).toBe(displayName("C1"))
    expect((screen.getByTestId("rendered-message") as HTMLTextAreaElement).value).toContain("Priya")

    // The button exists and is not the "nothing due" fallback.
    expect(screen.getByRole("button", { name: /Copy and mark as sent/i })).toBeTruthy()
    expect(screen.queryByText(/Nothing due/i)).toBeNull()
  })

  it("sending logs touch_1 AND moves the contact to Message sent, with no manual stage move", async () => {
    contact = { ...NOT_CONTACTED }
    // The mock applies the server's rule (stageAfterAction), so the move is
    // OBSERVED through the refetch rather than assumed from the request.
    authFetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const u = String(url)
      if (u.includes("/actions")) {
        const type = JSON.parse(init!.body!).type
        if (type === "touch_1" && (contact as { stage: string }).stage === "identified") {
          contact = { ...contact, stage: "sequence_active", next_due_reason: "touch_2" }
        }
        return json({ ok: true })
      }
      return api()(url, init)
    })

    await open()
    expect(screen.getByTestId("stage-pill").textContent).toBe("Not contacted")

    fireEvent.click(screen.getByRole("button", { name: /Copy and mark as sent/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    const log = authFetchMock.mock.calls.find((c) => String(c[0]).includes("/actions"))
    expect(JSON.parse(log![1].body).type).toBe("touch_1")

    // The stage moved, and NOT via the stage route — one action, one request.
    await waitFor(() => expect(screen.getByTestId("stage-pill").textContent).toBe("Message sent"))
    expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/stage"))).toBe(false)
  })

  it("still offers the picker when there is no relationship to choose a family from", async () => {
    contact = { ...NOT_CONTACTED, relationship: null }
    await open()
    // No suggestion is a real answer, not an error — the full list is offered.
    expect(screen.getByText(/Set a relationship to get a suggested template/i)).toBeTruthy()
    expect((screen.getByLabelText("Template") as HTMLSelectElement).options.length).toBe(25)
  })
})

describe("the header carries status", () => {
  it("shows one stage pill instead of the seven-segment bar", async () => {
    await open()
    expect(screen.getByTestId("stage-pill").textContent).toBe("Message sent")
    // The bar is gone, not hidden.
    expect(document.querySelectorAll("[data-phase]")).toHaveLength(0)
  })
})

describe("quick actions — split by likelihood", () => {
  it("the frequent forward moves are one tap and set the right stage", async () => {
    await open()
    // By LABEL, not testid: the testid is derived from the stage, so it would
    // still find the right button if the words on it were wired to the wrong move.
    fireEvent.click(screen.getByRole("button", { name: "They replied" }))
    await waitFor(() => expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/stage"))).toBe(true))
    const call = authFetchMock.mock.calls.findIndex((c) => String(c[0]).includes("/stage"))
    expect(bodyOf(call).stage).toBe("replied")

    // LABEL CHANGED 2026-08-04, not the behaviour. The pair of quick buttons
    // became the stepper circles, so this move is now named by its stage label:
    // "We talked" was the button's wording for the chat_done stage, whose label
    // is "Chat happened". Still by label, not testid, so the words still have to
    // be wired to the right move.
    fireEvent.click(screen.getByRole("button", { name: "Chat happened" }))
    await waitFor(() => {
      const stageCalls = authFetchMock.mock.calls.filter((c) => String(c[0]).includes("/stage"))
      expect(stageCalls).toHaveLength(2)
      expect(JSON.parse(stageCalls[1][1].body).stage).toBe("chat_done")
    })
  })

  it("the terminal moves are NOT one tap — they sit behind Change stage", async () => {
    await open()
    // Declined and outcome are reachable, but never a stray tap away on a screen
    // built for someone with no coach to undo it for them.
    expect(screen.queryByTestId("quick-dormant_declined")).toBeNull()
    expect(screen.queryByTestId("quick-outcome")).toBeNull()
    expect(screen.queryByLabelText("Stage")).toBeNull()

    fireEvent.click(screen.getByTestId("change-stage-open"))
    const select = screen.getByLabelText("Stage") as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toContain("dormant_declined")
    expect(values).toContain("outcome")
    expect(select.options).toHaveLength(11)   // all eleven, per the addition to the spec
  })

  it("does not offer a move to the stage the contact is already at", async () => {
    contact = { ...BASE, stage: "replied" }
    await open()
    // The circles replaced the quick buttons, so the handle moved from
    // quick-<stage> to step-<stage>. Same assertion: you cannot advance to
    // where you already are, and you can advance to what is ahead.
    expect((screen.getByTestId("step-replied") as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId("step-chat_done") as HTMLButtonElement).disabled).toBe(false)
  })
})

describe("the drawers", () => {
  it("Details opens for a contact with no relationship — the setup step", async () => {
    contact = { ...BASE, relationship: null }
    await open()
    expect(screen.getByTestId("drawer-body-details")).toBeTruthy()
    expect(screen.getByTestId("drawer-summary-details").textContent).toMatch(/Relationship not set/i)
  })

  it("Details stays shut once relationship is set, and summarises what is inside", async () => {
    await open()
    expect(screen.queryByTestId("drawer-body-details")).toBeNull()
    const summary = screen.getByTestId("drawer-summary-details").textContent ?? ""
    expect(summary).toContain("Cold")
    expect(summary).toContain("Priority A")
    expect(summary).toContain("Derivatives")
  })

  it("History and Notes auto-expand only when they have content", async () => {
    await open()
    expect(screen.queryByTestId("drawer-body-history")).toBeNull()
    expect(screen.queryByTestId("drawer-body-notes")).toBeNull()
    expect(screen.getByTestId("drawer-summary-history").textContent).toMatch(/Nothing yet/)

    cleanup()
    // TWO touches, ONE note, deliberately: with one of each, swapping the two
    // filters yields the same two summaries and the counts test nothing.
    actions = [
      { id: "a1", type: "touch_1", action_date: "2026-07-01T00:00:00Z", note: null, author_role: "client" },
      { id: "a3", type: "touch_2", action_date: "2026-07-08T00:00:00Z", note: null, author_role: "client" },
      { id: "a2", type: "note", action_date: "2026-07-02T00:00:00Z", note: "Met at the panel", author_role: "client" },
    ]
    await open()
    expect(screen.getByTestId("drawer-body-history")).toBeTruthy()
    expect(screen.getByTestId("drawer-body-notes")).toBeTruthy()
    // The counts split touches from notes — one source, two views.
    expect(screen.getByTestId("drawer-summary-history").textContent).toMatch(/2 touches logged/)
    expect(screen.getByTestId("drawer-summary-notes").textContent).toMatch(/1 note/)
  })

  it("a shut drawer opens on click and closes again", async () => {
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    expect(screen.getByTestId("drawer-body-history")).toBeTruthy()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    expect(screen.queryByTestId("drawer-body-history")).toBeNull()
  })

  it("a refetch does not slam a drawer shut while it is being read", async () => {
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-notes"))
    expect(screen.getByTestId("drawer-body-notes")).toBeTruthy()

    // Any save on the page refetches the contact. The drawer must survive it.
    fireEvent.click(screen.getByTestId("step-replied"))
    await waitFor(() => expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/stage"))).toBe(true))
    expect(screen.getByTestId("drawer-body-notes")).toBeTruthy()
  })
})

describe("nothing was removed", () => {
  it("all four text areas survive, consolidated into two drawers", async () => {
    contact = { ...BASE, relationship: null }
    await open()

    // Details drawer holds relationship/priority/segment AND additional info.
    const details = screen.getByTestId("drawer-body-details")
    expect(within(details).getByLabelText("Relationship")).toBeTruthy()
    expect(within(details).getByLabelText("Priority")).toBeTruthy()
    expect(within(details).getByLabelText("Additional info")).toBeTruthy()

    // Notes drawer holds "About this person" pinned above the running log.
    fireEvent.click(screen.getByTestId("drawer-toggle-notes"))
    const notes = screen.getByTestId("drawer-body-notes")
    expect(within(notes).getByLabelText("About this person")).toBeTruthy()
  })

  it("the reminder controls survive as one line", async () => {
    await open()
    const line = screen.getByTestId("reminder-line")
    // ASSERTION CHANGED 2026-08-04, not just a selector. This used to pin the
    // literal "Next:", which prefixed the due REASON ("Next: Send a reply").
    // That reason was removed in the top-half rework because the status above
    // and the hero's own button already said it, three statements of one fact.
    // What the line must still do is say WHEN, which is the part nothing else
    // on the screen carries, so that is what is asserted now.
    expect(line.textContent).toMatch(/Overdue by|Due |No reminder set/)
    fireEvent.click(within(line).getByTitle("Snooze 7 days"))
    await waitFor(() => {
      const call = authFetchMock.mock.calls.find((c) => String(c[0]).includes("/reminder"))
      expect(call).toBeTruthy()
      expect(JSON.parse(call![1].body).reminder_override).toBeTruthy()
    })
  })

  it("delete is still reachable, behind its own drawer", async () => {
    await open()
    expect(screen.queryByRole("button", { name: /Delete contact/i })).toBeNull()
    fireEvent.click(screen.getByTestId("drawer-toggle-danger"))
    expect(screen.getByRole("button", { name: /Delete contact/i })).toBeTruthy()
  })
})
