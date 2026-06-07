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
      <SharedDocumentsSection />
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
