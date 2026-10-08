"use client"

// The Coaches Dashboard's top ribbon: find a client, add a client, add a
// prospect.
//
// SEARCH. Nothing is listed until two characters are typed: the coach types a
// name, not picks from the roster. Matching (first or last name, from the start
// of the word, any case) and who counts as "my clients" (own, or the principal's
// for a delegate) are decided by GET /api/coach/clients/search. Arrow keys move
// through the matches; Enter opens the highlighted one, or the only one.
//
// The two buttons open the flows that already exist: CreateClientModal and
// AddProspectModal (the page owns those modals).

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, input, btnPrimary, btnSecondary } from "../../../lib/dashboard-theme"
import { MIN_QUERY, type SearchHit } from "../../../lib/coach/clientSearch"

async function authFetch(url: string): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, { headers: { Authorization: `Bearer ${token}` } })
}

export function CoachTopRibbon({ onAddClient, onAddProspect }: { onAddClient: () => void; onAddProspect: () => void }) {
  const router = useRouter()
  const listId = useId()
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const seq = useRef(0)
  const box = useRef<HTMLDivElement | null>(null)

  const ready = q.trim().length >= MIN_QUERY

  // Search 200 ms after typing stops; a slower earlier answer never overwrites a newer one.
  useEffect(() => {
    if (!ready) { setHits([]); setSearchedFor(null); setLoading(false); setError(null); setActive(-1); return }
    const mine = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await authFetch(`/api/coach/clients/search?q=${encodeURIComponent(q.trim())}`)
        const j = await res.json().catch(() => ({}))
        if (mine !== seq.current) return
        if (!res.ok || !j.ok) { setError(j.error || "Search failed"); setHits([]) }
        else { setError(null); setHits(j.clients ?? []) }
        setSearchedFor(q.trim())
        setActive(-1)
      } catch {
        if (mine === seq.current) setError("Search failed. Check your connection.")
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q, ready])

  // Close the list on a click anywhere else.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [])

  const go = (h: SearchHit) => { setOpen(false); router.push(h.href) }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, hits.length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, -1)) }
    else if (e.key === "Escape") { setOpen(false); setActive(-1) }
    else if (e.key === "Enter") {
      if (active >= 0 && hits[active]) { e.preventDefault(); go(hits[active]) }
      else if (hits.length === 1) { e.preventDefault(); go(hits[0]) }
    }
  }

  const showList = open && ready
  const settled = !loading && searchedFor === q.trim()

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start", marginBottom: 20 }}>
      <div ref={box} style={{ position: "relative", flex: "1 1 280px", minWidth: 0 }}>
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          aria-label="Search your clients by name"
          placeholder="Search clients by name"
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          style={{ ...input, width: "100%", boxSizing: "border-box" }}
        />
        {showList && (
          <div
            id={listId}
            role="listbox"
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, zIndex: 50,
              background: T.CARD, border: `1px solid ${T.BORDER}`, borderRadius: 12,
              boxShadow: "0 12px 28px rgba(0,0,0,0.18)", overflow: "hidden",
            }}
          >
            {error ? (
              <div role="alert" style={{ padding: "12px 14px", fontSize: 14, color: T.ERROR }}>{error}</div>
            ) : hits.length > 0 ? (
              hits.map((h, i) => (
                <div
                  key={h.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); go(h) }}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    padding: "11px 14px", fontSize: 15, fontWeight: 700, color: T.TEXT, cursor: "pointer",
                    background: i === active ? T.BORDER_SOFT : "transparent",
                  }}
                >
                  {h.name}
                </div>
              ))
            ) : settled ? (
              <div style={{ padding: "12px 14px", fontSize: 14, color: T.MUTED }}>No clients found.</div>
            ) : (
              <div style={{ padding: "12px 14px", fontSize: 14, color: T.MUTED }}>Searching...</div>
            )}
          </div>
        )}
      </div>
      <button type="button" onClick={onAddClient} style={{ ...btnPrimary, flex: "0 0 auto", whiteSpace: "nowrap" }}>
        + Add Client
      </button>
      <button type="button" onClick={onAddProspect} style={{ ...btnSecondary, flex: "0 0 auto", whiteSpace: "nowrap" }}>
        + Add Prospect
      </button>
    </div>
  )
}
