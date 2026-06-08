"use client"

// Coaching Tools — the client-facing (D2C) home for everything a coach shares
// with this coached account. This is the FIRST coached surface; it's built as a
// growable AREA: the page composes a vertical stack of self-contained sections,
// and more coached content (future slices) slots in as additional sections here
// — no new nav item, no restructure. Today there is one section: the shared
// document Library.
//
// Read-only. Each section owns its own fetch + loading/error/empty states (so a
// new section can't break an existing one). Auth is the client bearer pattern
// (same as the Job Tracker). The real access guard is the API: /api/me/documents
// scopes to the caller's own profile + visible_to_client, so a non-coached user
// who reaches this URL directly simply sees the empty state — never an error,
// never another client's data. The nav hides this for non-coached users; this
// page does not re-check (nav-hiding isn't access control — the API is).

import { useCallback, useEffect, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, headline, btnSecondary } from "../../../lib/dashboard-theme"

type SharedDoc = { id: string; title: string; url: string }
type DocGroup = { category_id: string | null; name: string; documents: SharedDoc[] }

type PlanActivity = { id: string; name: string; status: string; owner: string }
type PlanGroup = { deliverable_id: string; name: string; activities: PlanActivity[] }

// Activity status — mirrors the coach-side ActivityStatusControl visual language
// (muted → amber → green) so client + coach reads consistently. These constants
// aren't exported from EngagementsTab; kept in sync by convention.
const ACTIVITY_STATUS_ORDER = ["not_started", "in_progress", "complete"] as const
const ACTIVITY_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  not_started: { label: "Not started", color: T.MUTED, bg: T.NAV_DEFAULT_BG },
  in_progress: { label: "In progress", color: T.WRN_ORANGE, bg: "rgba(254,176,106,0.14)" },
  complete: { label: "Complete", color: T.SUCCESS, bg: T.SUCCESS_BG },
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

function fmtHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

export default function CoachingToolsPage() {
  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ ...headline, marginBottom: 6 }}>Coaching Tools</h1>
        <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
          Resources your coach has shared with you.
        </p>
      </div>

      {/* Sections compose here — add future coached surfaces below this one. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <MyPlanSection />
        <SharedDocumentsSection />
      </div>
    </div>
  )
}

// ── Section: My Plan — the client's own engagement activities ──
function MyPlanSection() {
  const [groups, setGroups] = useState<PlanGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [settingId, setSettingId] = useState<string | null>(null) // activity id in flight

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const token = await getToken()
      if (!token) { setLoadError("Please sign in again."); return }
      const res = await fetch("/api/me/activities", { headers: { Authorization: `Bearer ${token}` } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load your plan (${res.status})`)
        return
      }
      setGroups(j.groups || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Silent re-fetch to snap back to server truth after a write error.
  const resync = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch("/api/me/activities", { headers: { Authorization: `Bearer ${token}` } })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setGroups(j.groups || [])
    } catch {
      /* leave the action banner as the surfaced error */
    }
  }, [])

  const applyStatus = (gs: PlanGroup[], id: string, status: string) =>
    gs.map((g) => ({ ...g, activities: g.activities.map((a) => (a.id === id ? { ...a, status } : a)) }))

  async function setStatus(id: string, status: string) {
    if (settingId) return
    setSettingId(id)
    setActionError(null)
    setGroups((prev) => applyStatus(prev, id, status)) // optimistic
    try {
      const token = await getToken()
      if (!token) { setActionError("Please sign in again."); await resync(); return }
      const res = await fetch(`/api/me/activities/${id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update that item (${res.status})`)
        await resync()
        return
      }
      setGroups((prev) => applyStatus(prev, id, j.activity?.status ?? status)) // reconcile
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSettingId(null)
    }
  }

  return (
    <section style={{ ...card, padding: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 14 }}>
        My Plan
      </div>

      {actionError && (
        <div style={{ marginBottom: 14, fontSize: 12, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
          {actionError}
        </div>
      )}

      {loading ? (
        <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading…</p>
      ) : loadError ? (
        <div>
          <div style={{ fontSize: 12, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
            {loadError}
          </div>
          <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
        </div>
      ) : groups.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: 0, lineHeight: 1.5 }}>
          No plan items assigned to you yet — your coach will add them here.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map((g) => (
            <div key={g.deliverable_id}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 8 }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.activities.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10,
                      padding: "10px 12px", borderRadius: 12,
                      border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 160, fontSize: 14, color: T.TEXT, fontWeight: 600, wordBreak: "break-word" }}>
                      {a.name}
                      {a.owner === "both" && (
                        <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.DIM }}>
                          shared with coach
                        </span>
                      )}
                    </span>
                    <ActivityStatusControl
                      value={a.status}
                      busy={settingId === a.id}
                      onSet={(s) => void setStatus(a.id, s)}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Client-driven three-state status control — mirrors the coach-side
// ActivityStatusControl (muted → amber → green, hover + in-flight states).
function ActivityStatusControl({ value, busy, onSet }: { value: string; busy: boolean; onSet: (status: string) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)
  return (
    <div
      role="group"
      aria-label="Activity status"
      style={{ marginLeft: "auto", display: "inline-flex", flexShrink: 0, borderRadius: 7, border: `1px solid ${T.BORDER_SOFT}`, overflow: "hidden", opacity: busy ? 0.6 : 1 }}
    >
      {ACTIVITY_STATUS_ORDER.map((st, i) => {
        const active = value === st
        const m = ACTIVITY_STATUS_META[st]
        const isHover = hovered === st && !active && !busy
        return (
          <button
            key={st}
            type="button"
            disabled={busy || active}
            onClick={() => onSet(st)}
            onMouseEnter={() => { if (!active && !busy) setHovered(st) }}
            onMouseLeave={() => setHovered((h) => (h === st ? null : h))}
            aria-pressed={active}
            style={{
              background: active ? m.bg : isHover ? "rgba(255,255,255,0.06)" : "transparent",
              color: active ? m.color : isHover ? T.TEXT : T.MUTED,
              border: "none",
              borderLeft: i === 0 ? "none" : `1px solid ${isHover ? T.BORDER : T.BORDER_SOFT}`,
              padding: "4px 9px",
              fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
              cursor: busy ? "default" : "pointer",
              whiteSpace: "nowrap",
              transition: "background 130ms ease, color 130ms ease, border-color 130ms ease",
            }}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Section: shared document Library ──
function SharedDocumentsSection() {
  const [groups, setGroups] = useState<DocGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const token = await getToken()
      if (!token) { setLoadError("Please sign in again."); return }
      const res = await fetch("/api/me/documents", { headers: { Authorization: `Bearer ${token}` } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load your documents (${res.status})`)
        return
      }
      setGroups(j.groups || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  return (
    <section style={{ ...card, padding: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 14 }}>
        Shared documents
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading…</p>
      ) : loadError ? (
        <div>
          <div style={{ fontSize: 12, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
            {loadError}
          </div>
          <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
        </div>
      ) : groups.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: 0, lineHeight: 1.5 }}>
          Your coach hasn’t shared any tools or documents with you yet.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {groups.map((g) => (
            <div key={g.category_id ?? "__uncategorized__"}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 8 }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.documents.map((d) => (
                  <a
                    key={d.id}
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: "block", textDecoration: "none",
                      padding: "10px 12px", borderRadius: 12,
                      border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
                    }}
                  >
                    <span style={{ fontSize: 14, color: T.WRN_BLUE, fontWeight: 600, wordBreak: "break-word" }}>{d.title}</span>
                    <span style={{ display: "block", fontSize: 12, color: T.DIM, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {fmtHost(d.url)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
