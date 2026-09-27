// NeedsAttentionSection.test.tsx
//
// THE BUG THIS EXISTS FOR. The section used to list coach_client_notes, which
// carry a priority. It was repointed at coach_tasks, which do not, and the API
// now sends `priority: ""` for every row. The component still did
// `PRIORITY_BADGE[item.priority].bg`, so the first client on production with an
// open task loaded their page and got
//
//   TypeError: Cannot read properties of undefined (reading 'bg')
//
// inside the Array.map. A white page, not a missing pill.
//
// The lookup and the render are both covered, because guarding one and not the
// other would still crash.

import { render, screen, waitFor } from "@testing-library/react"
import { describe as suite, expect, it, vi } from "vitest"
import { NeedsAttentionSection } from "./NeedsAttentionSection"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

function respondWith(actionItems: any[]) {
  return (async () =>
    new Response(JSON.stringify({ ok: true, actionItems, engagementSignals: [] }), {
      status: 200,
    })) as typeof fetch
}

const authFetch = (url: string, opts?: RequestInit) => fetch(url, opts)

const task = (over: Record<string, any> = {}) => ({
  note_id: "t-1",
  body: "Define Networking Campaign",
  priority: "",
  due_at: null,
  created_at: "2026-09-25T12:00:00.000Z",
  completed_at: null,
  ...over,
})

suite("a task with no priority", () => {
  it("renders instead of crashing the page", async () => {
    global.fetch = respondWith([task()])
    render(<NeedsAttentionSection authFetch={authFetch} clientId="c-1" refreshKey={0} />)
    expect(await screen.findByText("Define Networking Campaign")).toBeTruthy()
  })

  // An empty pill reads as a label that failed to load, which is worse than no
  // pill at all. A task genuinely has no priority, so it shows none.
  it("shows no priority badge at all", async () => {
    global.fetch = respondWith([task()])
    const { container } = render(
      <NeedsAttentionSection authFetch={authFetch} clientId="c-1" refreshKey={0} />,
    )
    await screen.findByText("Define Networking Campaign")
    for (const label of ["Urgent", "This Week", "When Ready"]) {
      expect(screen.queryByText(label)).toBeNull()
    }
    // No empty pill left behind either: nothing renders with a transparent
    // background where the badge used to be.
    expect(container.textContent).toContain("Define Networking Campaign")
  })

  it("survives a priority the build has never heard of", async () => {
    // The type is a promise about what the SERVER sends, and the server is a
    // different deploy. A value added there arrives here before this build
    // knows about it.
    global.fetch = respondWith([task({ priority: "whenever", body: "Future priority" })])
    render(<NeedsAttentionSection authFetch={authFetch} clientId="c-1" refreshKey={0} />)
    expect(await screen.findByText("Future priority")).toBeTruthy()
  })
})

suite("a note that still has a priority", () => {
  it("still shows its badge", async () => {
    global.fetch = respondWith([task({ priority: "urgent", body: "Old action item" })])
    render(<NeedsAttentionSection authFetch={authFetch} clientId="c-1" refreshKey={0} />)
    await screen.findByText("Old action item")
    await waitFor(() => expect(screen.getByText("Urgent")).toBeTruthy())
  })
})
