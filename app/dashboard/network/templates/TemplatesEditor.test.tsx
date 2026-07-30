// Phase 8e — the template editor. The saved counterpart to 8d's scratchpad.
//
// The four required properties: an edit saves as an override, revert deletes it,
// the preview tracks the edit live, and dropping a variable the default had
// warns without blocking.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import TemplatesPage from "./page"
import { TEMPLATE_GROUPS, SAMPLE_CONTACT, droppedVariables, ungroupedIds } from "./groups"
import { DEFAULTS_BY_ID, TEMPLATE_IDS } from "../../../../lib/network-tracker/templates"

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

const PROFILE = {
  client_first: "Jordan",
  current_role_title: "Senior Marketing Analyst",
  current_employer: "Northbrook Consumer Group",
  target_role: "Marketing Analytics",
  target_field: "Marketing",
  city: "Chicago",
  school: "University of Illinois",
  key_strength: "turning messy data into decisions",
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
    return json({ ok: true, profile: PROFILE })
  }
}
const json = (v: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => v } as unknown as Response)

const bodyBox = () => screen.getByTestId("template-body") as HTMLTextAreaElement
const preview = () => screen.getByTestId("preview").textContent ?? ""

afterEach(cleanup)
beforeEach(() => {
  params = new URLSearchParams()
  overrides = {}
  replaceMock.mockClear()
  authFetchMock.mockReset()
  authFetchMock.mockImplementation(api())
})

async function open(id?: string) {
  if (id) params = new URLSearchParams(`id=${id}`)
  const utils = render(<TemplatesPage />)
  await waitFor(() => expect(screen.queryByTestId("template-body")).toBeTruthy())
  return utils
}

describe("the list", () => {
  it("shows all 24 templates, each exactly once, under family headings", async () => {
    await open()
    const placed = TEMPLATE_GROUPS.flatMap((g) => g.ids)
    expect(placed.length).toBe(24)
    expect(new Set(placed).size).toBe(24)
    expect(ungroupedIds()).toEqual([])       // nothing silently uneditable
    expect(TEMPLATE_IDS.every((id) => screen.queryByTestId(`pick-${id}`))).toBe(true)

    // Grouping mirrors RELATIONSHIP_TO_FAMILY: 1 intro + 5 sequences of 3 + 5 S + 3 L.
    expect(TEMPLATE_GROUPS.map((g) => g.ids.length)).toEqual([1, 3, 3, 3, 3, 3, 5, 3])
    // Headings come from RELATIONSHIP_LABELS; the A1/C2 template IDs beside them
    // are IDs, not labels, and deliberately do not follow a rename.
    for (const h of ["Personal", "Something in Common", "Referral", "Cold", "Recruiter"]) {
      expect(screen.getByText(h)).toBeTruthy()
    }
  })

  it("deep-links: ?id=C2 opens C2, and picking one writes the URL", async () => {
    const { rerender } = await open("C2")
    expect(screen.getByTestId("editing-id").textContent).toBe("C2")

    fireEvent.click(screen.getByTestId("pick-R1"))
    expect(String(replaceMock.mock.calls.at(-1)![0])).toContain("id=R1")
    rerender(<TemplatesPage />)
    await waitFor(() => expect(screen.getByTestId("editing-id").textContent).toBe("R1"))
  })
})

describe("editing and saving writes an override", () => {
  it("PATCHes the edited body and the template comes back marked as yours", async () => {
    await open("C2")
    expect(screen.getByTestId("source-badge").textContent).toMatch(/Default/)

    const edited = bodyBox().value + " One more line."
    fireEvent.change(bodyBox(), { target: { value: edited } })
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))

    await waitFor(() => expect(screen.getByTestId("editor-notice").textContent).toMatch(/C2 saved/))
    const patch = authFetchMock.mock.calls.find((c) => c[1]?.method === "PATCH")
    expect(String(patch![0])).toBe("/api/network/templates/C2")
    expect(JSON.parse(patch![1].body).body).toBe(edited)

    // Reloaded from the server, not assumed: the badge and the list dot both flip.
    await waitFor(() => expect(screen.getByTestId("source-badge").textContent).toMatch(/Your version/))
    expect(screen.getByTestId("edited-dot-C2")).toBeTruthy()
    expect(overrides.C2).toBe(edited)
  })

  it("Save is disabled until something actually changes", async () => {
    await open("C2")
    const save = screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(bodyBox(), { target: { value: bodyBox().value + "!" } })
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("switching templates abandons an unsaved edit rather than carrying it over", async () => {
    const { rerender } = await open("C2")
    fireEvent.change(bodyBox(), { target: { value: "half-written" } })

    fireEvent.click(screen.getByTestId("pick-C3"))
    rerender(<TemplatesPage />)
    await waitFor(() => expect(screen.getByTestId("editing-id").textContent).toBe("C3"))

    expect(bodyBox().value).toBe(DEFAULTS_BY_ID.C3.body)
    expect(authFetchMock.mock.calls.some((c) => c[1]?.method === "PATCH")).toBe(false)
  })
})

describe("revert deletes the override", () => {
  it("DELETEs and the template returns to the default body", async () => {
    overrides.C2 = "my own wording"
    await open("C2")
    expect(bodyBox().value).toBe("my own wording")
    expect(screen.getByTestId("source-badge").textContent).toMatch(/Your version/)

    fireEvent.click(screen.getByTestId("revert"))
    await waitFor(() => expect(screen.getByTestId("editor-notice").textContent).toMatch(/back to the default/))

    const del = authFetchMock.mock.calls.find((c) => c[1]?.method === "DELETE")
    expect(String(del![0])).toBe("/api/network/templates/C2")
    expect(overrides.C2).toBeUndefined()
    await waitFor(() => expect(bodyBox().value).toBe(DEFAULTS_BY_ID.C2.body))
    expect(screen.getByTestId("source-badge").textContent).toMatch(/Default/)
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

    await waitFor(() => expect(screen.getByTestId("editor-notice").textContent).toMatch(/back to the default/))
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

  it("catches the hardcoded name — the case this preview exists for", async () => {
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

    // Warned, not blocked — dropping a variable can be exactly what someone means.
    expect((screen.getByRole("button", { name: /^Save$/ }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(overrides.C2).toBe("Hi Dana, following up."))
  })

  it("stays silent when the edit keeps every variable", async () => {
    await open("C2")
    fireEvent.change(bodyBox(), { target: { value: bodyBox().value + " Thanks again." } })
    expect(screen.queryByTestId("dropped-warning")).toBeNull()
  })

  it("counts only what the DEFAULT had — adding variables is not a drop", async () => {
    expect(droppedVariables("C2", DEFAULTS_BY_ID.C2.body + " [CITY]")).toEqual([])
    expect(droppedVariables("C2", "no variables at all"))
      .toEqual(expect.arrayContaining(["NAME"]))
  })
})

describe("the palette", () => {
  it("groups by where the value comes from and inserts at the caret", async () => {
    await open("C2")
    for (const label of ["From your profile", "From the contact", "Fill in when you send"]) {
      expect(screen.getByText(label)).toBeTruthy()
    }

    fireEvent.change(bodyBox(), { target: { value: "Hi , welcome." } })
    const ta = bodyBox()
    ta.setSelectionRange(3, 3)          // caret between "Hi " and ","
    fireEvent.click(screen.getByTestId("chip-NAME"))

    expect(bodyBox().value).toBe("Hi [NAME], welcome.")
  })

  it("offers every variable the 24 defaults actually use", async () => {
    await open("C2")
    const used = new Set(Object.values(DEFAULTS_BY_ID).flatMap((d) =>
      (d.body.match(/\[([^\]]+)\]/g) ?? []).map((m) => m.slice(1, -1))))
    for (const v of used) expect(screen.queryByTestId(`chip-${v}`)).toBeTruthy()
  })
})
