// Phase 8e, redesigned per UX-TEMPLATES.md: the saved counterpart to 8d's
// scratchpad, navigated by who you are writing to.
//
// The four editor properties are unchanged and still required: an edit saves as
// an override, revert deletes it, the preview tracks the edit live, and dropping
// a variable the default had warns without blocking.
//
// What the redesign adds: no letter code reaches the screen, every surfaced
// template has a plain name, and ?id= resolves to a relationship AND a card.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import TemplatesPage from "./page"
import { SAMPLE_CONTACT, droppedVariables } from "./groups"
import { NAME_BY_ID, unplacedIds, unnamedIds, REPLY_IDS, LINKEDIN_IDS, sequenceIds } from "./templateNames"
import { menuLabel } from "./InsertFieldMenu"
import { DEFAULTS_BY_ID, TEMPLATE_IDS, classifyVariable } from "../../../../lib/network-tracker/templates"

let params = new URLSearchParams()
const replaceMock = vi.fn((url: string) => { params = new URLSearchParams(String(url).split("?")[1] ?? "") })
vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard/network/templates",
}))

const authFetchMock = vi.fn()
vi.mock("../authFetch", () => ({
  authFetch: (...a: unknown[]) => authFetchMock(...a),
  getToken: async () => "t",
}))

// Complete enough to clear sendReadiness()'s four must-haves, so the default
// fixture is a user who is READY and the profile-gap banner is absent unless a
// test deliberately empties it.
const PROFILE = {
  client_first: "Jordan",
  current_role_title: "Senior Marketing Analyst",
  current_employer: "Northbrook Consumer Group",
  target_role: "Marketing Analytics",
  target_field: "Marketing",
  elevator_pitch: "I turn messy data into decisions people act on.",
  city: "Chicago",
  school: "University of Illinois",
  key_strength: "turning messy data into decisions",
  help_dismissed: { templates: true },
}

// Server-side override store, so a save is observable by the next GET the way it
// would be in production rather than only as a fetch call.
let overrides: Record<string, string> = {}

function api() {
  return (url: string, init?: { method?: string; body?: string }) => {
    const u = String(url)
    const method = init?.method ?? "GET"

    if (u.startsWith("/api/network/templates/")) {
      const id = u.split("/").pop()!
      if (method === "PATCH") {
        const sent = JSON.parse(init!.body!).body as string
        // Mirrors the route: saving the default back verbatim IS a revert.
        if (sent.trim() === DEFAULTS_BY_ID[id].body.trim()) {
          delete overrides[id]
          return json({ ok: true, template_id: id, source: "default", reverted: true })
        }
        overrides[id] = sent
        return json({ ok: true, template: { template_id: id, body: sent, source: "override" } })
      }
      if (method === "DELETE") {
        delete overrides[id]
        return json({ ok: true, template_id: id, source: "default" })
      }
    }
    if (u === "/api/network/templates") {
      return json({
        ok: true,
        templates: Object.values(DEFAULTS_BY_ID).map((d) => ({
          template_id: d.id, label: d.label,
          body: overrides[d.id] ?? d.body,
          source: overrides[d.id] ? "override" : "default",
        })),
      })
    }
    if (u === "/api/network/profile" && method === "PATCH") {
      const sent = JSON.parse(init!.body!)
      return json({ ok: true, profile: { ...PROFILE, help_dismissed: { templates: sent.dismissed !== false } } })
    }
    return json({ ok: true, profile: profileFixture })
  }
}
// Per-test override, so a test can hand back an empty or partial profile.
let profileFixture: Record<string, unknown> = PROFILE
const json = (v: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => v } as unknown as Response)

const bodyBox = () => screen.getByTestId("template-body") as HTMLTextAreaElement
const preview = () => screen.getByTestId("preview").textContent ?? ""

afterEach(cleanup)
beforeEach(() => {
  params = new URLSearchParams()
  overrides = {}
  profileFixture = PROFILE
  replaceMock.mockClear()
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(api())
})

/** Render the screen. With an id, that card arrives expanded (the deep link). */
async function open(id?: string) {
  if (id) params = new URLSearchParams(`id=${id}`)
  const utils = render(<TemplatesPage />)
  if (id) await waitFor(() => expect(screen.queryByTestId("template-body")).toBeTruthy())
  else await waitFor(() => expect(screen.queryByTestId("who-picker")).toBeTruthy())
  return utils
}

describe("no code reaches the screen", () => {
  // The headline of the redesign, asserted over the whole rendered output rather
  // than field by field, so a code leaking back in through any surface fails
  // here: a card, a heading, a save notice, a badge.
  const CODE = /\b(IN|[PARCXSL][1-5])\b/

  it("renders no letter code, collapsed or expanded", async () => {
    const { container } = await open()
    expect(container.textContent ?? "").not.toMatch(CODE)

    cleanup()
    const deep = await open("A2")
    expect(deep.container.textContent ?? "").not.toMatch(CODE)
  })

  it("says nothing in code after a save either", async () => {
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: bodyBox().value + " One more line." } })
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(screen.getByTestId("editor-notice")).toBeTruthy())
    expect(screen.getByTestId("editor-notice").textContent ?? "").not.toMatch(CODE)
  })
})

describe("placement and naming invariants", () => {
  it("gives all 24 templates somewhere to live and a plain name to live under", () => {
    expect(TEMPLATE_IDS.length).toBe(24)
    expect(unplacedIds()).toEqual([])   // nothing silently unreachable
    expect(unnamedIds()).toEqual([])    // nothing rendering as a bare code

    // The three groups account for every template: 5 sequences of 3, 6 replies,
    // 3 LinkedIn. Stated as a total rather than a shape so adding a sixth
    // relationship does not need this line edited.
    const surfaced = [
      ...["personal", "affinity", "referred", "cold", "recruiter"].flatMap(sequenceIds),
      ...REPLY_IDS, ...LINKEDIN_IDS,
    ]
    expect(new Set(surfaced).size).toBe(24)
  })

  it("names every surfaced template in words, never a code", () => {
    for (const id of TEMPLATE_IDS) {
      expect(NAME_BY_ID[id]).toBeTruthy()
      expect(NAME_BY_ID[id]).not.toMatch(/\b(IN|[PARCXSL][1-5])\b/)
    }
  })

  it("tracks RELATIONSHIP_LABELS for the LinkedIn connect notes", () => {
    // L1/L2 disambiguate by relationship, so they must follow a picker rename
    // rather than saying "affinity" while the picker says something else.
    expect(NAME_BY_ID.L1).toBe("Connect note · Something in Common")
    expect(NAME_BY_ID.L2).toBe("Connect note · Cold")
  })
})

describe("picking who you are messaging", () => {
  it("shows that relationship's three messages, named and dated", async () => {
    await open()
    // Personal is the landing relationship.
    for (const id of sequenceIds("personal")) expect(screen.getByTestId(`card-${id}`)).toBeTruthy()
    for (const name of ["First outreach", "Follow-up", "Last follow-up"]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
    expect(screen.getByText("day 0")).toBeTruthy()
    expect(screen.getByText("day 7")).toBeTruthy()
    expect(screen.getByText("day 12")).toBeTruthy()

    // Switching swaps the sequence, without a second dropdown.
    fireEvent.click(screen.getByTestId("who-cold"))
    for (const id of sequenceIds("cold")) expect(screen.getByTestId(`card-${id}`)).toBeTruthy()
    expect(screen.queryByTestId("card-P1")).toBeNull()
  })

  it("surfaces the replies and the LinkedIn notes whatever is selected", async () => {
    await open()
    for (const id of [...REPLY_IDS, ...LINKEDIN_IDS]) {
      expect(screen.getByTestId(`card-${id}`)).toBeTruthy()
    }
  })

  it("marks which are yours and which are still the default", async () => {
    overrides.P2 = "my own wording"
    await open()
    expect(screen.getByTestId("marker-P2").textContent).toMatch(/Edited by you/)
    expect(screen.getByTestId("marker-P1").textContent).toMatch(/Default/)
  })
})

describe("deep links resolve to a relationship and a card", () => {
  it("?id=C2 lands on Cold with the second card open", async () => {
    await open("C2")
    // The relationship followed the link...
    expect(screen.getByTestId("who-cold").getAttribute("aria-selected")).toBe("true")
    // ...and only that card is expanded.
    expect(screen.getByTestId("open-C2").getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByTestId("open-C1").getAttribute("aria-expanded")).toBe("false")
    expect(bodyBox().value).toBe(DEFAULTS_BY_ID.C2.body)
  })

  it("a reply deep-links too, without disturbing the sequence shown", async () => {
    await open("S4")
    expect(screen.getByTestId("open-S4").getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByTestId("who-personal").getAttribute("aria-selected")).toBe("true")
  })

  it("clicking a card writes the URL, and clicking it again collapses", async () => {
    const { rerender } = await open()
    fireEvent.click(screen.getByTestId("open-P3"))
    expect(String(replaceMock.mock.calls.at(-1)![0])).toContain("id=P3")

    rerender(<TemplatesPage />)
    await waitFor(() => expect(screen.getByTestId("open-P3").getAttribute("aria-expanded")).toBe("true"))

    fireEvent.click(screen.getByTestId("open-P3"))
    expect(String(replaceMock.mock.calls.at(-1)![0])).not.toContain("id=")
  })

  it("switching relationship closes whatever was open", async () => {
    await open("C2")
    fireEvent.click(screen.getByTestId("who-recruiter"))
    expect(String(replaceMock.mock.calls.at(-1)![0])).not.toContain("id=")
  })
})

describe("editing and saving writes an override", () => {
  it("PATCHes the edited body and the template comes back marked as yours", async () => {
    await open("C2")
    expect(screen.getByTestId("marker-C2").textContent).toMatch(/Default/)

    const edited = bodyBox().value + " One more line."
    fireEvent.change(bodyBox(), { target: { value: edited } })
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))

    await waitFor(() => expect(screen.getByTestId("editor-notice").textContent).toMatch(/Saved/))
    const patch = authFetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")
    expect(String(patch![0])).toBe("/api/network/templates/C2")
    expect(JSON.parse(patch![1].body).body).toBe(edited)

    // Reloaded from the server, not assumed: the card's marker flips.
    await waitFor(() => expect(screen.getByTestId("marker-C2").textContent).toMatch(/Edited by you/))
    expect(overrides.C2).toBe(edited)
  })

  it("Save is disabled until something actually changes", async () => {
    await open("C2")
    const save = screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(bodyBox(), { target: { value: bodyBox().value + "!" } })
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("collapsing a card abandons an unsaved edit rather than carrying it over", async () => {
    const { rerender } = await open("C2")
    fireEvent.change(bodyBox(), { target: { value: "half-written" } })

    fireEvent.click(screen.getByTestId("open-C3"))
    rerender(<TemplatesPage />)
    await waitFor(() => expect(screen.getByTestId("open-C3").getAttribute("aria-expanded")).toBe("true"))

    expect(bodyBox().value).toBe(DEFAULTS_BY_ID.C3.body)
    expect(authFetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false)
  })
})

describe("revert deletes the override", () => {
  it("DELETEs and the template returns to the default body", async () => {
    overrides.C2 = "my own wording"
    await open("C2")
    expect(bodyBox().value).toBe("my own wording")
    expect(screen.getByTestId("marker-C2").textContent).toMatch(/Edited by you/)

    fireEvent.click(screen.getByTestId("revert"))
    await waitFor(() => expect(screen.getByTestId("editor-notice").textContent).toMatch(/Back to the default/))

    const del = authFetchMock.mock.calls.find((c) => c[1]?.method === "DELETE")
    expect(String(del![0])).toBe("/api/network/templates/C2")
    expect(overrides.C2).toBeUndefined()
    await waitFor(() => expect(bodyBox().value).toBe(DEFAULTS_BY_ID.C2.body))
    expect(screen.getByTestId("marker-C2").textContent).toMatch(/Default/)
  })

  it("offers revert only for a template that HAS an override", async () => {
    await open("C2")
    expect(screen.queryByTestId("revert")).toBeNull()

    cleanup()
    overrides.C2 = "mine"
    await open("C2")
    expect(screen.getByTestId("revert")).toBeTruthy()
  })

  it("saving the default back verbatim is treated as a revert, not an override", async () => {
    overrides.C2 = "mine"
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: DEFAULTS_BY_ID.C2.body } })
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))

    await waitFor(() => expect(screen.getByTestId("editor-notice").textContent).toMatch(/Back to the default/))
    expect(overrides.C2).toBeUndefined()   // no row left behind
  })
})

describe("the live preview", () => {
  it("renders against the real profile and the fixed sample contact", async () => {
    await open("C1")
    expect(preview()).toContain(SAMPLE_CONTACT.first_name)
    expect(preview()).toContain(PROFILE.target_role)
    expect(preview()).not.toMatch(/\[(NAME|TARGET_ROLE|CURRENT_ROLE)\]/)
  })

  it("updates as you type, before anything is saved", async () => {
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: "Hi [NAME], one quick thing." } })

    // The substitution happens live, which is what makes the preview worth watching.
    expect(preview()).toBe("Hi Priya, one quick thing.")
    expect(authFetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false)
  })

  it("catches the hardcoded name, the case this preview exists for", async () => {
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: "Hi Dana, one quick thing." } })
    // Every preview now says Dana no matter who it is addressed to.
    expect(preview()).toContain("Dana")
    expect(preview()).not.toContain("Priya")
  })

  it("shows a blank, never a raw bracket, for a profile field with no value", async () => {
    authFetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) =>
      String(url) === "/api/network/profile" ? json({ ok: true, profile: {} }) : api()(url, init))
    await open("C1")
    expect(preview()).not.toMatch(/\[TARGET_ROLE\]/)
    expect(preview()).toContain("_____")
    expect(screen.getByTestId("preview-unresolved").textContent).toMatch(/\[TARGET_ROLE\]/)
  })
})

describe("the dropped-variable warning", () => {
  it("fires, names the variable, and does NOT block the save", async () => {
    await open("C2")
    expect(screen.queryByTestId("dropped-warning")).toBeNull()

    // C2 carries [NAME]; replacing it with a literal name is the hardcode case.
    fireEvent.change(bodyBox(), { target: { value: "Hi Dana, following up." } })

    const warn = screen.getByTestId("dropped-warning")
    expect(warn.textContent).toMatch(/\[NAME\]/)

    // Warned, not blocked, because dropping a variable can be exactly what someone means.
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(overrides.C2).toBe("Hi Dana, following up."))
  })

  it("stays silent when the edit keeps every variable", async () => {
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: bodyBox().value + " Thanks again." } })
    expect(screen.queryByTestId("dropped-warning")).toBeNull()
  })

  it("counts only what the DEFAULT had, so adding variables is not a drop", async () => {
    expect(droppedVariables("C2", DEFAULTS_BY_ID.C2.body + " [CITY]")).toEqual([])
    expect(droppedVariables("C2", "no variables at all"))
      .toEqual(expect.arrayContaining(["NAME"]))
  })
})

describe("the help layers", () => {
  it("always shows the plain intro line", async () => {
    await open()
    expect(screen.getByText(/These are your outreach messages, ready to send/)).toBeTruthy()
  })

  it("warns when the profile is below the send-ready threshold, and links to it", async () => {
    // Missing elevator_pitch alone drops it under. The threshold is imported
    // from the profile screen, not restated here.
    profileFixture = { ...PROFILE, elevator_pitch: "" }
    await open()
    const banner = screen.getByTestId("profile-gap-banner")
    expect(banner.textContent).toMatch(/previews below will have gaps/)
    expect(screen.getByTestId("profile-gap-link").getAttribute("href")).toBe("/dashboard/network/profile")
  })

  it("stays quiet once the profile clears the threshold", async () => {
    await open()
    expect(screen.queryByTestId("profile-gap-banner")).toBeNull()
  })

  it("never blocks the page: the templates render underneath the warning", async () => {
    profileFixture = {}
    await open()
    expect(screen.getByTestId("profile-gap-banner")).toBeTruthy()
    expect(screen.getByTestId("sequence")).toBeTruthy()
    for (const id of sequenceIds("personal")) expect(screen.getByTestId(`card-${id}`)).toBeTruthy()
  })

  it("shows 'How this works' to someone who has not dismissed it", async () => {
    profileFixture = { ...PROFILE, help_dismissed: {} }
    await open()
    const box = screen.getByTestId("how-this-works")
    expect(box.textContent).toMatch(/Pick who you're messaging/)
    expect(box.textContent).toMatch(/amber ones are\s+yours to write/)
  })

  it("dismisses, and persists the dismissal", async () => {
    profileFixture = { ...PROFILE, help_dismissed: {} }
    await open()
    fireEvent.click(screen.getByTestId("how-this-works-dismiss"))

    expect(screen.queryByTestId("how-this-works")).toBeNull()
    await waitFor(() => {
      const patch = authFetchMock.mock.calls.find(
        (c) => String(c[0]) === "/api/network/profile" && c[1]?.method === "PATCH")
      expect(patch).toBeTruthy()
      const sent = JSON.parse(patch![1].body)
      expect(sent).toMatchObject({ action: "dismiss_help", surface: "templates", dismissed: true })
    })
  })

  it("stays dismissed on the next visit, but can be reopened", async () => {
    await open()   // fixture has help_dismissed.templates = true
    expect(screen.queryByTestId("how-this-works")).toBeNull()

    fireEvent.click(screen.getByTestId("how-this-works-reopen"))
    expect(screen.getByTestId("how-this-works")).toBeTruthy()
  })

  it("opens and closes the Insert field popover", async () => {
    await open("C2")
    const label = "About insert field"
    expect(screen.queryByTestId(`help-panel-${label}`)).toBeNull()

    fireEvent.click(screen.getByTestId(`help-${label}`))
    expect(screen.getByTestId(`help-panel-${label}`).textContent).toMatch(/Calm ones fill themselves/)

    fireEvent.click(screen.getByTestId(`help-${label}`))
    expect(screen.queryByTestId(`help-panel-${label}`)).toBeNull()
  })

  it("opens the edit-area popover and closes it on Escape", async () => {
    await open("C2")
    const label = "About editing here"
    fireEvent.click(screen.getByTestId(`help-${label}`))
    expect(screen.getByTestId(`help-panel-${label}`).textContent)
      .toMatch(/edit it on their contact page instead/)

    fireEvent.keyDown(document, { key: "Escape" })
    await waitFor(() => expect(screen.queryByTestId(`help-panel-${label}`)).toBeNull())
  })

  it("says none of it in jargon", async () => {
    profileFixture = { ...PROFILE, help_dismissed: {}, elevator_pitch: "" }
    const { container } = await open("C2")
    fireEvent.click(screen.getByTestId("insert-field-button"))
    fireEvent.click(screen.getByTestId("help-About insert field"))
    expect(container.textContent ?? "").not.toMatch(/merge variable|template variable|\btoken\b|mail.?merge/i)
  })
})

describe("the two kinds of bracket", () => {
  const kinds = (host: HTMLElement, kind: "auto" | "fill") =>
    Array.from(host.querySelectorAll(`[data-bracket="${kind}"]`)).map((n) => n.textContent)

  it("colours fill-at-send prompts apart from the ones that fill themselves", async () => {
    // IN carries both: [MUTUAL] and [TARGET_FIELD] are a fill prompt and a
    // profile variable sitting in one body.
    await open("IN")
    const editor = screen.getByTestId("body-highlight")
    expect(kinds(editor, "fill")).toContain("[MUTUAL]")
    expect(kinds(editor, "auto")).toContain("[TARGET_FIELD]")
  })

  it("carries the split into the preview, where the auto ones are already gone", async () => {
    await open("S1")     // "Scheduling a call": [OPTION 1..3] are fill prompts
    const pv = screen.getByTestId("preview")
    expect(kinds(pv, "fill")).toEqual(expect.arrayContaining(["[OPTION 1]", "[OPTION 2]"]))
    // [NAME] resolved against the sample contact, so it is text now, not a bracket.
    expect(kinds(pv, "fill")).not.toContain("[NAME]")
    expect(preview()).toContain(SAMPLE_CONTACT.first_name)
  })

  it("treats an unfilled profile blank as calm, not as your action", async () => {
    authFetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) =>
      String(url) === "/api/network/profile" ? json({ ok: true, profile: {} }) : api()(url, init))
    await open("C1")
    // "_____" is a slot that fills ITSELF once the profile has a value, so the
    // writer is not being asked to type into it, so it must not read as warm.
    expect(kinds(screen.getByTestId("preview"), "auto")).toContain("_____")
    expect(kinds(screen.getByTestId("preview"), "fill")).not.toContain("_____")
  })

  it("colours without altering a single character of the body", async () => {
    await open("IN")
    // The highlight layer must render the body EXACTLY, or the text drifts off
    // the textarea it sits behind.
    expect(screen.getByTestId("body-highlight").textContent?.replace(/​/g, ""))
      .toBe(DEFAULTS_BY_ID.IN.body)
  })
})

describe("the Insert field menu", () => {
  const openMenu = () => fireEvent.click(screen.getByTestId("insert-field-button"))

  it("groups by where the value comes from, under plain-English headers", async () => {
    await open("C2")
    expect(screen.queryByTestId("insert-field-menu")).toBeNull()   // shut until asked
    openMenu()

    for (const heading of ["About you", "About them", "You fill this in"]) {
      expect(screen.getByText(heading)).toBeTruthy()
    }

    // classifyVariable is the authority, so the grouping is asserted against IT
    // rather than against a list restated here, so the menu and the bracket
    // colouring cannot drift apart without this failing.
    const kind = { profile: "profile", contact: "contact", fill: "fill" } as const
    for (const [key, group] of Object.entries(kind)) {
      const host = screen.getByTestId(`menu-group-${group}`)
      const tokens = Array.from(host.querySelectorAll("[data-testid^='insert-']"))
        .map((n) => n.getAttribute("data-testid")!.replace("insert-", ""))
      expect(tokens.length).toBeGreaterThan(0)
      for (const t of tokens) expect(classifyVariable(t)).toBe(key)
    }
  })

  it("inserts the real bracket at the caret", async () => {
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: "Hi , welcome." } })
    const ta = bodyBox()
    ta.setSelectionRange(3, 3)          // caret between "Hi " and ","

    openMenu()
    fireEvent.mouseDown(screen.getByTestId("insert-NAME"))   // must not steal focus
    fireEvent.click(screen.getByTestId("insert-NAME"))

    expect(bodyBox().value).toBe("Hi [NAME], welcome.")
    expect(screen.queryByTestId("insert-field-menu")).toBeNull()  // closes after
  })

  it("shows friendly labels but inserts the jargon token", async () => {
    expect(menuLabel("AFFINITY_1")).toBe("Something you share")
    expect(menuLabel("CURRENT_ROLE")).toBe("Your current role")
    expect(menuLabel("KEY_STRENGTH")).toBe("Your strength")
    expect(menuLabel("CURRENT_EMPLOYER")).toBe("Your current employer")
    expect(menuLabel("TARGET_FIELD")).toBe("Field you're moving into")
    expect(menuLabel("TARGET_ROLE")).toBe("Role you're targeting")
    expect(menuLabel("NAME")).toBe("Their name")
    expect(menuLabel("FIRM")).toBe("Their company")
    expect(menuLabel("CITY")).toBe("Your city")

    // No auto-resolving variable may be bare. A row showing a naked [TOKEN]
    // beside rows with a name reads as a rendering bug, so every profile and
    // contact variable the menu offers must have one.
    const offered = new Set(Object.values(DEFAULTS_BY_ID).flatMap((d) =>
      (d.body.match(/\[([^\]]+)\]/g) ?? []).map((m) => m.slice(1, -1))))
    const bare = [...offered]
      .filter((t) => classifyVariable(t) !== "fill")
      .filter((t) => menuLabel(t) === `[${t}]`)
    expect(bare).toEqual([])

    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: "" } })
    openMenu()
    expect(screen.getByText("Something you share")).toBeTruthy()
    fireEvent.click(screen.getByTestId("insert-AFFINITY_1"))
    // The friendly name is a label; what lands in the body is the real token.
    expect(bodyBox().value).toBe("[AFFINITY_1]")
  })

  it("offers every variable the 24 defaults actually use", async () => {
    await open("C2")
    openMenu()
    const used = new Set(Object.values(DEFAULTS_BY_ID).flatMap((d) =>
      (d.body.match(/\[([^\]]+)\]/g) ?? []).map((m) => m.slice(1, -1))))
    for (const v of used) expect(screen.queryByTestId(`insert-${v}`)).toBeTruthy()
  })
})
