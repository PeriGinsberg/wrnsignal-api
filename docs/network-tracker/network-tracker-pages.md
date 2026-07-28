# Network Tracker — Pages & API (v1)

**Stack reality:** SIGNAL has **no server actions and no cookie SSR.** Pages are
`"use client"` components that get a Supabase session token and call **API route
handlers** (`app/api/**/route.ts`) with `Authorization: Bearer <token>`. The route
resolves the user with **`resolveCaller(req)`** (`lib/collab/identity.ts`) →
`{ profileId, isCoach }`, where `profileId` is the owner's `client_profiles.id`.
Mutations run the reminder engine **inside the route**, in exactly one place.
Refresh is client-side re-fetch (`setState`) — not `revalidatePath`.

Route home is **`app/dashboard/network`** (`/tracker` is taken by the job tracker).

## Route tree

```
app/dashboard/network/
  layout.tsx                          // shell: switch worklist / companies / contact
  page.tsx                            // DAILY WORKLIST (client) — the front door
  companies/page.tsx                  // COMPANY BOARD (client)
  contacts/[contactId]/page.tsx       // CONTACT RECORD (client): pipeline + log + notes/comments
  WorklistRow.tsx, CompanyCard.tsx, PipelineStepper.tsx, ActionLog.tsx, CommentThread.tsx  // client components

app/api/network/
  worklist/route.ts                                   // GET worklist
  companies/route.ts                                  // GET board, POST company
  companies/[companyId]/route.ts                      // GET/PATCH company, comments
  contacts/route.ts                                   // POST create contact, GET list
  contacts/[contactId]/route.ts                       // GET contact bundle, PATCH
  contacts/[contactId]/actions/route.ts               // POST logAction  (runs engine)
  contacts/[contactId]/stage/route.ts                 // POST changeStage (runs engine)
  contacts/[contactId]/reminder/route.ts              // POST setReminderOverride (runs engine)
  contacts/[contactId]/comments/route.ts              // GET/POST comments (coach layer)
  import/route.ts                                     // POST CSV import (never writes tracker state)

lib/network-tracker/
  reminder-engine.ts                                  // computeNextDue() — pure, one file
  access.ts                                           // assertOwnerOrCoach() — shared gate (below)
```

## The shared access gate — `lib/network-tracker/access.ts`

Every network route resolves the caller, then confirms they may touch this board:
the **owner** (`client_profile_id === profileId`) OR a **coach** with an active
`coach_clients` link at the right level (`verifyCoachAccess`). Mirrors the coach/client
notes routes.

```ts
import { getSupabaseAdmin } from "@/lib/collab/identity"
import { verifyCoachAccess } from "@/lib/collab/access"

// Returns { ownerClientId, actingProfileId, actingRole } or throws a typed 403/404.
export async function assertBoardAccess(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  callerProfileId: string,
  ownerClientId: string,
  level: "view" | "annotate" | "full",
) {
  if (ownerClientId === callerProfileId) {
    return { ownerClientId, actingProfileId: callerProfileId, actingRole: "client" as const }
  }
  const access = await verifyCoachAccess(callerProfileId, ownerClientId, level, supabase)
  if (!access) return null                     // caller is neither owner nor an authorized coach
  return { ownerClientId, actingProfileId: callerProfileId, actingRole: "coach" as const }
}
```

## Read: the worklist, end to end

### API — `app/api/network/worklist/route.ts`

```ts
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

export async function GET(req: NextRequest) {
  try {
    const { profileId } = await resolveCaller(req)          // owner = this client_profiles.id
    const supabase = getSupabaseAdmin()
    const { data, error } = await supabase
      .from("network_contacts")
      .select("id, first_name, last_name, stage, next_due_at, next_due_reason, network_companies(name)")
      .eq("client_profile_id", profileId)
      .lte("next_due_at", new Date().toISOString())
      .order("next_due_at", { ascending: true })            // overdue first, single indexed scan
    if (error) throw new Error(`Worklist failed: ${error.message}`)
    return withCorsJson(req, { ok: true, contacts: data ?? [] }, 200)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
```
> A coach viewing a client's board hits `GET /api/network/worklist?client_profile_id=<id>`;
> the handler runs `assertBoardAccess(..., "view")` on that id instead of defaulting to `profileId`.
> The self/owner path above is the common case.

### Page — `app/dashboard/network/page.tsx` (client component)

```tsx
"use client"
import { useCallback, useEffect, useState } from "react"
import { getSupabaseBrowser } from "@/lib/supabase-browser"
import { WorklistRow } from "./WorklistRow"

async function getToken() {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  return session?.access_token ?? sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } })
}

export default function WorklistPage() {
  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await authFetch("/api/network/worklist")
    const j = await res.json().catch(() => ({}))
    setContacts(res.ok && j?.ok ? j.contacts : [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  if (loading) return <p>Loading your networking…</p>
  return (
    <main>
      <h1>Your networking today</h1>
      {contacts.length === 0
        ? <p>Nothing due. Add a target or reach out to someone new.</p>
        : contacts.map(c => <WorklistRow key={c.id} contact={c} onChanged={load} />)}
    </main>
  )
}
```

## Write: log an action, end to end (the important wiring)

### API — `app/api/network/contacts/[contactId]/actions/route.ts`

```ts
import { type NextRequest } from "next/server"
import { corsOptionsResponse, withCorsJson } from "../../../../_lib/cors"
import { getSupabaseAdmin, resolveCaller } from "@/lib/collab/identity"
import { assertBoardAccess } from "@/lib/network-tracker/access"
import { computeNextDue } from "@/lib/network-tracker/reminder-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export async function OPTIONS(req: NextRequest) { return corsOptionsResponse(req.headers.get("origin")) }

const ACTION_TYPES = new Set(["initial_contact","follow_up_1","follow_up_2","follow_up_3","thank_you",
  "connection_request","engage_on_post","meeting_scheduled","meeting_held","note_logged","other"])

export async function POST(req: NextRequest, { params }: { params: Promise<{ contactId: string }> }) {
  try {
    const { contactId } = await params
    const { profileId } = await resolveCaller(req)
    const supabase = getSupabaseAdmin()

    // Load the contact by id ONLY, then gate on its owner (owner or authorized coach).
    const { data: c } = await supabase.from("network_contacts")
      .select("id, client_profile_id, stage, created_at, reminder_override, dormant_since").eq("id", contactId).maybeSingle()
    if (!c) return withCorsJson(req, { ok: false, error: "Contact not found" }, 404)
    // v1: action-logging + stage changes are CLIENT-ONLY. A coach cannot mutate the
    // pipeline (coach access is view=read / annotate=comment only). Owner-gate here.
    if (c.client_profile_id !== profileId)
      return withCorsJson(req, { ok: false, error: "Forbidden: pipeline edits are owner-only" }, 403)

    // Validate body (server-set author fields, never trusted from body).
    const body = await req.json().catch(() => null)
    const type = body?.type
    if (typeof type !== "string" || !ACTION_TYPES.has(type)) return withCorsJson(req, { ok: false, error: "bad type" }, 400)
    const actionDate = body?.action_date ? new Date(body.action_date) : new Date()
    if (isNaN(actionDate.getTime())) return withCorsJson(req, { ok: false, error: "bad action_date" }, 400)
    const note = typeof body?.note === "string" ? body.note.trim() || null : null

    // 1) write the log entry — author from the SESSION, not the body
    const { error: insErr } = await supabase.from("network_actions").insert({
      contact_id: contactId, type, action_date: actionDate.toISOString(), note,
      author_role: "client",                // v1: only the owner logs actions
      author_id: profileId,
    })
    if (insErr) throw new Error(`Log failed: ${insErr.message}`)

    // 2) reload actions, run the engine (the ONE place due dates are computed)
    const { data: acts } = await supabase.from("network_actions").select("type").eq("contact_id", contactId)
    const due = computeNextDue({
      stage: c.stage, createdAt: c.created_at, lastActionAt: actionDate,
      reminderOverride: c.reminder_override, dormantSince: c.dormant_since,
      pokeEnabled: false, actions: acts ?? [],
    })

    // 3) save the result (engine may flip stage -> dormant); trigger sets updated_at
    const { error: updErr } = await supabase.from("network_contacts").update({
      last_action_at: actionDate.toISOString(),
      next_due_at: due.nextDueAt, next_due_reason: due.nextDueReason,
      ...(due.stage ? { stage: due.stage } : {}),
      ...(due.dormantSince ? { dormant_since: due.dormantSince } : {}),
    }).eq("id", contactId)
    if (updErr) throw new Error(`Update failed: ${updErr.message}`)

    return withCorsJson(req, { ok: true }, 201)
  } catch (err: any) {
    const msg = err?.message || String(err)
    const status = /unauthorized/i.test(msg) ? 401 : /profile not found/i.test(msg) ? 404 : 500
    return withCorsJson(req, { ok: false, error: msg }, status)
  }
}
```

### Client — `WorklistRow.tsx` quick "logged it"

```tsx
"use client"
// ...getToken/authFetch as above...
export function WorklistRow({ contact, onChanged }: { contact: any; onChanged: () => void }) {
  async function loggedIt() {
    const res = await authFetch(`/api/network/contacts/${contact.id}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "follow_up_1", action_date: new Date().toISOString() }),
    })
    if (res.ok) onChanged()          // re-fetch the worklist (no revalidatePath)
  }
  return (
    <div>
      <span>{contact.first_name} {contact.last_name}</span>
      <span>{contact.network_companies?.name}</span>
      <span>{contact.next_due_reason}</span>
      <button onClick={loggedIt}>Logged it</button>
    </div>
  )
}
```

`changeStage`, `setReminderOverride`, `editCompany`, and the coach `comments` POST follow the
same shape: `resolveCaller` → `assertBoardAccess` → write → (engine where relevant) → save →
client re-fetch. Keeping `computeNextDue()` in the route means the worklist can never drift
from the action log.

## Coach comments — reuse the coaching_notes pattern
`GET/POST /api/network/contacts/[contactId]/comments` mirrors the coach/client notes routes:
`resolveCaller` + `assertBoardAccess`; the GET returns the owner's own comments + coach `shared`
comments (coach `private` excluded), newest-first; POST server-sets `author_role`/`coach_profile_id`/
`client_profile_id`, validates `body`/`visibility`. Same OR-filter and share-confirm UX as the
JobFit/Cover Letter thread. `<CommentThread>` is the client component in the contact record.

## Build order (spine first)
1. `reminder-engine.ts` + `access.ts` + `logAction` route — the spine.
2. Worklist page + row — proves the loop end to end with seed data.
3. Contact record (pipeline stepper + action log + notes/comments).
4. Company board (reads + priority/status edits, zero-contact wishlist firms).
5. CSV import route (never writes tracker state).
```
