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

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString()
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
  // The action box and its two template fetches are gone with SendPanel, so the
  // stage pill is the anchor now: it is in the header, it renders from the
  // contact the page already loaded, and it is present on every fixture here.
  await waitFor(() => expect(screen.queryByTestId("stage-pill")).toBeTruthy())
  return utils
}

/**
 * WHERE THINGS STAND, after the stepper.
 *
 * The nine-circle path answered "which of eleven stages is this in", which is
 * not the question anyone arrives with. These pin the question it answers now:
 * what did I last do, when, and do I need to start. If a future change makes
 * the card stop saying one of those, that is the regression.
 */
describe("where things stand says what you last did and when", () => {
  it("names the last action and how long ago, not a stage", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    actions = [
      { id: "a2", type: "touch_2", action_date: daysAgo(39), note: null, author_role: "client" },
      { id: "a1", type: "touch_1", action_date: daysAgo(94), note: null, author_role: "client" },
    ]
    await open()
    const head = screen.getByTestId("wts-headline").textContent ?? ""
    expect(head).toContain("second follow-up")
    expect(head).toMatch(/weeks ago|months ago|days ago/)
    // The read is a separate sentence, and must not restate the stage label.
    expect(screen.getByTestId("wts-read").textContent).toContain("No reply yet")
  })

  it("says plainly when nothing has happened, and offers the first step", async () => {
    contact = { ...BASE, stage: "identified", next_due_reason: null }
    actions = []
    await open()
    expect(screen.getByTestId("wts-headline").textContent).toContain("not reached out")
    expect(screen.getByTestId("wts-write").textContent).toContain("Write the first message")
  })

  it("does NOT count an unsent draft as something you did", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    actions = [
      { id: "d1", type: "touch_3", action_date: daysAgo(1), status: "draft", body: "hi", author_role: "client" },
      { id: "a1", type: "touch_1", action_date: daysAgo(60), note: null, author_role: "client" },
    ]
    await open()
    // The draft is newer. If it counted, the headline would say touch_3.
    expect(screen.getByTestId("wts-headline").textContent).toContain("reached out")
  })

  it("keeps the stage, demoted to a pill rather than a path", async () => {
    contact = { ...BASE, stage: "replied" }
    await open()
    expect(screen.getByTestId("stage-pill").textContent).toBe("They replied")
    // And the nine circles are gone, not hidden.
    expect(document.querySelectorAll('[data-testid^="step-"]')).toHaveLength(0)
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


  /**
   * Every stage a user can reach has to be visible where they look for stages.
   * These two were reachable ONLY through a dropdown behind a button that said
   * "Other moves", so a tester hunted for them and reported them as absent.
   */

  it("…but they are NOT steps on the path", async () => {
    // The reason they were excluded in the first place still holds: a stepper
    // whose last circle reads "Not interested" makes it look like a goal.
    await open()
    expect(screen.queryByTestId("step-dormant_no_answer")).toBeNull()
    expect(screen.queryByTestId("step-dormant_declined")).toBeNull()
  })



  it("the dropdown is labelled by what is in it", async () => {
    // "Other moves" named the mechanism, not the content, which is why someone
    // looking for a STAGE did not open it.
    await open()
    expect(screen.getByTestId("change-stage-open").textContent).toContain("Change stage")
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
    // Was a click on a stepper circle; the circles went with the Where Things
    // Stand redesign, and this test never cared WHICH save it was.
    fireEvent.click(within(screen.getByTestId("reminder-line")).getByTitle("Snooze 7 days"))
    await waitFor(() => expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/reminder"))).toBe(true))
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
    // ASSERTION CHANGED TWICE, and the intent has never changed: the line must
    // say WHEN, which is the part nothing else on the screen carries.
    //   2026-08-04  stopped pinning "Next:", which prefixed the due REASON.
    //   2026-09-02  "Due" became "Follow-up reminder". Due is a word about an
    //               obligation; this is a note the student left themselves and
    //               nobody is owed it.
    // Still deliberately a loose match on the phrasing rather than an exact
    // string, so the next copy change does not fail a test about behaviour.
    expect(line.textContent).toMatch(/Follow-up reminder|No reminder set/)
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

/**
 * "About this person" — the box a tester reported as silently discarding her
 * typing.
 *
 * The write path was never broken. It sat directly above the note log's own
 * textarea under one "Notes" heading, and the log's "Save note" was the
 * dominant button in the drawer; she typed here, reached for that button, and
 * it did nothing at all, because it is disabled while the log's own box is
 * empty. No error, no feedback. A disabled button that gives no feedback is
 * indistinguishable from a broken one.
 *
 * So the second click is gone. These pin what replaced it.
 */
describe("about-this-person commits without a second click", () => {
  const patches = () =>
    authFetchMock.mock.calls.filter(
      (c) => String(c[0]) === "/api/network/contacts/c1" && (c[1] as RequestInit)?.method === "PATCH",
    )

  it("SAVES ON BLUR, with no Save button to find", async () => {
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-notes"))
    const box = within(screen.getByTestId("drawer-body-notes")).getByLabelText("About this person")

    // The control that used to be here, and whose absence is the fix.
    expect(within(screen.getByTestId("drawer-body-notes")).queryByRole("button", { name: /^Save$/ })).toBeNull()

    fireEvent.change(box, { target: { value: "Met at the Chicago meetup." } })
    expect(patches().length).toBe(0) // nothing written mid-typing
    fireEvent.blur(box)

    await waitFor(() => expect(patches().length).toBe(1))
    expect(JSON.parse((patches()[0][1] as RequestInit).body as string))
      .toEqual({ notes: "Met at the Chicago meetup." })
  })

  it("says so while the text is unsaved, rather than sitting silent", async () => {
    // Silence next to typed text is what made the old version read as broken.
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-notes"))
    const body = screen.getByTestId("drawer-body-notes")
    const box = within(body).getByLabelText("About this person")

    expect(within(body).queryByText(/Saves when you click away/)).toBeNull()
    fireEvent.change(box, { target: { value: "Draft" } })
    expect(within(body).getByText(/Saves when you click away/)).toBeTruthy()
  })

  it("does NOT write when nothing changed", async () => {
    // Blur fires on every pass through the field. Tabbing over an untouched box
    // must not PATCH.
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-notes"))
    const box = within(screen.getByTestId("drawer-body-notes")).getByLabelText("About this person")
    fireEvent.blur(box)
    fireEvent.blur(box)
    expect(patches().length).toBe(0)
  })

  it("names BOTH boxes, so they stop reading as one control rendered twice", async () => {
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-notes"))
    const body = screen.getByTestId("drawer-body-notes")
    expect(within(body).getByText("About this person")).toBeTruthy()
    expect(within(body).getByText("Add a note")).toBeTruthy()
  })
})

/**
 * THE OFFER. Actions and stages described the same events and did not respond
 * to each other: logging "Chat done" left the stage reading "Message sent", and
 * a tester reported the two systems as contradicting. The stage stays something
 * you ASSERT — so this proposes, never decides.
 */
describe("logging an action offers the stage it implies", () => {
  it("offers the move, naming the action and the destination", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    await open()
    // Log a chat from the History drawer.
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    // The manual form is shut by default now: history mostly writes itself,
    // and this records the off-SIGNAL case. Open it before logging.
    fireEvent.click(screen.getByTestId("log-manual-open"))
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "chat_done" } })
    fireEvent.click(screen.getByRole("button", { name: /Log it/i }))

    const offer = await screen.findByTestId("stage-offer")
    // Both halves matter: WHICH action, and WHERE it would go.
    expect(offer.textContent).toContain("Chat done")
    expect(offer.textContent).toContain("You talked")
  })

  it("takes ONE TAP, and sets the implied stage", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    // The manual form is shut by default now: history mostly writes itself,
    // and this records the off-SIGNAL case. Open it before logging.
    fireEvent.click(screen.getByTestId("log-manual-open"))
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "chat_done" } })
    fireEvent.click(screen.getByRole("button", { name: /Log it/i }))
    fireEvent.click(await screen.findByTestId("stage-offer-accept"))

    await waitFor(() => {
      const stageCalls = authFetchMock.mock.calls.filter((c) => String(c[0]).includes("/stage"))
      expect(stageCalls.length).toBeGreaterThan(0)
      expect(JSON.parse(stageCalls[stageCalls.length - 1][1].body).stage).toBe("chat_done")
    })
  })

  it("is DISMISSIBLE, and dismissing writes nothing", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    // The manual form is shut by default now: history mostly writes itself,
    // and this records the off-SIGNAL case. Open it before logging.
    fireEvent.click(screen.getByTestId("log-manual-open"))
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "chat_done" } })
    fireEvent.click(screen.getByRole("button", { name: /Log it/i }))
    fireEvent.click(await screen.findByTestId("stage-offer-dismiss"))

    await waitFor(() => expect(screen.queryByTestId("stage-offer")).toBeNull())
    // The action itself was logged; only the stage move was declined.
    expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/stage"))).toBe(false)
  })

  it("does NOT offer for an action that implies nothing", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    // The manual form is shut by default now: history mostly writes itself,
    // and this records the off-SIGNAL case. Open it before logging.
    fireEvent.click(screen.getByTestId("log-manual-open"))
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "note_logged" } })
    fireEvent.click(screen.getByRole("button", { name: /Log it/i }))
    await waitFor(() => expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/actions"))).toBe(true))
    expect(screen.queryByTestId("stage-offer")).toBeNull()
  })

  it("does NOT offer a move backwards", async () => {
    // A chat logged from nurture implies a stage already passed. Dragging the
    // stage back would be the worst failure this could have.
    contact = { ...BASE, stage: "nurture" }
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    // The manual form is shut by default now: history mostly writes itself,
    // and this records the off-SIGNAL case. Open it before logging.
    fireEvent.click(screen.getByTestId("log-manual-open"))
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "chat_done" } })
    fireEvent.click(screen.getByRole("button", { name: /Log it/i }))
    await waitFor(() => expect(authFetchMock.mock.calls.some((c) => String(c[0]).includes("/actions"))).toBe(true))
    expect(screen.queryByTestId("stage-offer")).toBeNull()
  })

  it("shows no offer before anything has been logged", async () => {
    await open()
    expect(screen.queryByTestId("stage-offer")).toBeNull()
  })
})

describe("the one automatic case explains itself on screen", () => {
  it("says at `identified` that a first outreach will move the stage", async () => {
    // The rule lived only in a code comment. The person it affects cannot read
    // that, and the consequence of NOT saying it is a contact that advances
    // without being asked.
    contact = { ...BASE, stage: "identified" }
    await open()
    const note = screen.getByTestId("auto-advance-note")
    expect(note.textContent).toContain("first message")
    expect(note.textContent).toContain("Message sent")
  })

  it("does not say it anywhere else, where it is not true", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    await open()
    expect(screen.queryByTestId("auto-advance-note")).toBeNull()
  })
})

describe("the two kinds of note are not both called Note", () => {
  it("labels the pipeline action so it cannot be mistaken for an inert note", async () => {
    // `note_logged` resets the clock and consumes a reminder override; the
    // Notes drawer's `note` is deliberately inert. Both were called "Note", in
    // two places, on one screen.
    await open()
    fireEvent.click(screen.getByTestId("drawer-toggle-history"))
    const picker = screen.getByLabelText("Action") as HTMLSelectElement
    const noteLogged = Array.from(picker.options).find((o) => o.value === "note_logged")!
    expect(noteLogged.text).toBe("Contact activity")
    // And no OTHER option may claim the word either.
    expect(Array.from(picker.options).filter((o) => o.text === "Note")).toHaveLength(0)
  })
})


/**
 * The offer at logging time is dismissible and its dismissal is session state,
 * so one dismissal used to leave a contact contradicting its own history
 * permanently, with nothing ever saying so. This states the evidence instead of
 * asking again — a question demands an answer and answers have to be
 * remembered; a statement can just be true on every visit.
 */
describe("the record says what the log shows", () => {
  it("states the evidence when the log is ahead of the stage", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    actions = [
      { id: "a1", type: "touch_1", action_date: "2026-06-01T12:00:00Z", note: null, author_role: "client" },
      { id: "a2", type: "chat_done", action_date: "2026-06-12T12:00:00Z", note: null, author_role: "client" },
    ]
    await open()
    const line = screen.getByTestId("log-evidence")
    expect(line.textContent).toMatch(/Your log shows/)
    expect(line.textContent).toMatch(/Chat done/)
    // Locale-agnostic: the date follows the viewer's locale, like every other
    // date on this screen, so pinning one order would fail off en-US.
    expect(line.textContent).toMatch(/Jun 12|12 Jun/)
  })

  it("OFFERS NOTHING — no buttons, nothing to dismiss", async () => {
    // The whole reason this needs no persistence.
    contact = { ...BASE, stage: "sequence_active" }
    actions = [
      { id: "a2", type: "chat_done", action_date: "2026-06-12T12:00:00Z", note: null, author_role: "client" },
    ]
    await open()
    const line = screen.getByTestId("log-evidence")
    expect(within(line).queryByRole("button")).toBeNull()
  })

  it("reads as EVIDENCE, never as a correction", async () => {
    // Being behind your own log is a legitimate position: the chat went
    // nowhere, you are parking them, you disagree it counted. The stage is
    // still a fact the user asserts, so nothing here may imply a mistake.
    contact = { ...BASE, stage: "sequence_active" }
    actions = [
      { id: "a2", type: "chat_done", action_date: "2026-06-12T12:00:00Z", note: null, author_role: "client" },
    ]
    await open()
    const text = screen.getByTestId("log-evidence").textContent ?? ""
    for (const scold of [/should/i, /update/i, /out of date/i, /incorrect/i, /forgot/i, /wrong/i, /fix/i]) {
      expect(text).not.toMatch(scold)
    }
  })

  it("says nothing when the stage is already ahead of the log", async () => {
    contact = { ...BASE, stage: "nurture" }
    actions = [
      { id: "a2", type: "chat_done", action_date: "2026-06-12T12:00:00Z", note: null, author_role: "client" },
    ]
    await open()
    expect(screen.queryByTestId("log-evidence")).toBeNull()
  })

  it("says nothing with no history", async () => {
    contact = { ...BASE, stage: "sequence_active" }
    actions = []
    await open()
    expect(screen.queryByTestId("log-evidence")).toBeNull()
  })
})
