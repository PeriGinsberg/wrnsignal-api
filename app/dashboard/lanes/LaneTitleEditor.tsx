"use client"

// Lane titles, and the discovery control that fills them.
//
// Titles are the only writable field — see app/api/lanes/[id]/route.ts for why.
// The rest of the config is shown because you cannot judge a title without it:
// the same phrase searched with a keyword and without one returns different
// jobs, and a title that looks wrong is often a keyword that is.
//
// Every title change saves immediately rather than accumulating behind a Save
// button. Discovery is a loop — search, add, search again — and a dirty-state
// buffer in the middle of that loop is one more thing to lose.
//
// Self-contained on purpose: it loads its own lane config rather than taking one
// as a prop. The lane summary the list endpoint returns omits companies and
// exclusions, so a caller could not hand over a complete config even if it
// wanted to, and two shapes of the same thing is how they drift.

import { useCallback, useEffect, useState } from "react"
import { T, card, eyebrow, input, btnPrimary, btnSecondary } from "../../../lib/dashboard-theme"
import { authFetch, locationLabel, type Discovery, type LaneConfig } from "./laneApi"

export function LaneTitleEditor({
  laneId,
  showConfig = true,
  onTitlesChange,
  onActiveChange,
}: {
  laneId: string
  showConfig?: boolean
  /** Fired after a successful save so a surrounding list can re-label itself. */
  onTitlesChange?: (titles: string[]) => void
  /** Fired after the lane is paused or resumed. */
  onActiveChange?: (active: boolean) => void
}) {
  const [lane, setLane] = useState<LaneConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [phrase, setPhrase] = useState("")
  const [searching, setSearching] = useState(false)
  const [discovery, setDiscovery] = useState<Discovery | null>(null)

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      // Switching lanes must not leave the previous lane's discovery results on
      // screen underneath the new lane's titles.
      setDiscovery(null)
      setPhrase("")
      const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}`)
      const j = await res.json().catch(() => ({}))
      if (!live) return
      if (!res.ok || !j.ok) {
        setError(j.error || "Could not load this lane")
        setLane(null)
        setLoading(false)
        return
      }
      setError(null)
      setLane(j.lane)
      setLoading(false)
    })()
    return () => {
      live = false
    }
  }, [laneId])

  // One writer for both add and remove. Optimistic, with the previous list kept
  // so a rejected write restores exactly what was on screen — the same pattern
  // the review queue uses for its rows.
  const saveTitles = useCallback(
    async (next: string[]) => {
      if (!lane) return
      const previous = lane.titles
      setLane({ ...lane, titles: next })
      setSaving(true)
      const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}`, {
        method: "PATCH",
        body: JSON.stringify({ titles: next }),
      })
      setSaving(false)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        setError(j.error || "Could not save that title change")
        setLane((prev) => (prev ? { ...prev, titles: previous } : prev))
        return
      }
      setError(null)
      setLane(j.lane)
      onTitlesChange?.(j.lane.titles as string[])
      // Re-flag what is already on the lane so the discovery list cannot offer
      // to add a title twice.
      setDiscovery((prev) =>
        prev
          ? {
              ...prev,
              titles: prev.titles.map((t) => ({
                ...t,
                already: (j.lane.titles as string[]).includes(t.title.toLowerCase()),
              })),
            }
          : prev
      )
    },
    [lane, laneId, onTitlesChange]
  )

  // Pausing is not deleting: the lane keeps every result it has found and its
  // whole run history, and only stops being picked up by the nightly sweep,
  // which selects active = true. That is why lanes are paused rather than
  // removed when a client's search changes.
  const setActive = useCallback(
    async (next: boolean) => {
      if (!lane) return
      const previous = lane.active
      setLane({ ...lane, active: next })
      setSaving(true)
      const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}`, {
        method: "PATCH",
        body: JSON.stringify({ active: next }),
      })
      setSaving(false)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        setError(j.error || "Could not change the lane's status")
        setLane((prev) => (prev ? { ...prev, active: previous } : prev))
        return
      }
      setError(null)
      setLane(j.lane)
      onActiveChange?.(j.lane.active as boolean)
    },
    [lane, laneId, onActiveChange]
  )

  const search = useCallback(async () => {
    const p = phrase.trim()
    if (!p) return
    setSearching(true)
    setDiscovery(null)
    const res = await authFetch(
      `/api/lanes/discover-titles?lane_id=${encodeURIComponent(laneId)}&phrase=${encodeURIComponent(p)}`
    )
    const j = await res.json().catch(() => ({}))
    setSearching(false)
    if (!res.ok || !j.ok) {
      setError(j.error || "Discovery failed")
      return
    }
    setError(null)
    setDiscovery(j)
  }, [phrase, laneId])

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading lane…</p>
  if (!lane) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error || "Lane not found"}</p>

  return (
    <div>
      {error && (
        <div
          role="alert"
          style={{
            ...card,
            borderColor: T.ERROR,
            background: T.ERROR_BG,
            color: T.ERROR,
            fontSize: 13,
            padding: "12px 16px",
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      {/* Read-only context. These shape every search below. */}
      {showConfig && (
        <div style={{ ...card, padding: "16px 18px", marginBottom: 14, display: "flex", gap: 28, flexWrap: "wrap" }}>
          <ConfigFact label="Keyword" value={lane.keyword ?? "none"} dim={!lane.keyword} />
          <ConfigFact label="Location" value={locationLabel(lane.location)} />
          <ConfigFact label="Years max" value={lane.years_max == null ? "no ceiling" : String(lane.years_max)} />
          <ConfigFact
            label="Excluded title words"
            value={lane.exclusions?.title_keywords?.join(", ") || "none"}
            dim={!lane.exclusions?.title_keywords?.length}
          />
          <div>
            <div style={{ ...eyebrow, color: T.DIM, marginBottom: 4 }}>Status</div>
            <button
              type="button"
              onClick={() => setActive(!lane.active)}
              disabled={saving}
              title={lane.active ? "Pause this lane — it stops running but keeps everything it has found" : "Resume the nightly run"}
              style={{
                background: "transparent",
                border: `1px solid ${lane.active ? T.BORDER : T.ORANGE_BORDER}`,
                borderRadius: 999,
                padding: "3px 12px",
                fontSize: 12,
                fontWeight: 800,
                cursor: saving ? "not-allowed" : "pointer",
                color: lane.active ? T.SUCCESS : T.WRN_ORANGE,
              }}
            >
              {lane.active ? "Active — pause" : "Paused — resume"}
            </button>
          </div>
        </div>
      )}

      <section style={{ ...card, padding: "18px 20px", marginBottom: 14 }}>
        <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 12 }}>
          Titles {saving && <span style={{ color: T.DIM, fontWeight: 500 }}>· saving…</span>}
        </div>
        {lane.titles.map((t) => (
          <div
            key={t}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 0",
              borderBottom: `1px solid ${T.BORDER_SOFT}`,
              fontSize: 13,
              color: T.TEXT,
            }}
          >
            <span>
              {t}
              {lane.keyword && (
                <span style={{ color: T.DIM, marginLeft: 8, fontSize: 12 }}>
                  → sends &ldquo;{t} {lane.keyword}&rdquo;
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => saveTitles(lane.titles.filter((x) => x !== t))}
              disabled={saving || lane.titles.length === 1}
              title={lane.titles.length === 1 ? "A lane needs at least one title" : "Remove this title"}
              style={{
                background: "none",
                border: "none",
                color: lane.titles.length === 1 ? T.DIM : T.MUTED,
                fontSize: 12,
                cursor: lane.titles.length === 1 ? "not-allowed" : "pointer",
              }}
            >
              remove
            </button>
          </div>
        ))}
      </section>

      <section style={{ ...card, padding: "18px 20px" }}>
        <div style={{ ...eyebrow, color: T.MUTED, marginBottom: 6 }}>Discover titles</div>
        <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 12px" }}>
          Enter a rough phrase. It is searched with this lane&apos;s keyword and location, and grouped by the
          board&apos;s own job title.
        </p>

        <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search()
            }}
            placeholder="front office"
            style={{ ...input, flex: 1 }}
          />
          <button
            type="button"
            onClick={search}
            disabled={searching || !phrase.trim()}
            style={{ ...btnPrimary, opacity: searching || !phrase.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>

        {/* The exact query, before it is sent. The keyword is appended to every
            search, so a phrase that looks fine can still be searched as
            something that returns nothing. */}
        {phrase.trim() && (
          <p style={{ fontSize: 12, color: T.DIM, margin: "0 0 14px" }}>
            sends &ldquo;{lane.keyword ? `${phrase.trim()} ${lane.keyword}` : phrase.trim()}&rdquo;,{" "}
            {locationLabel(lane.location)}
          </p>
        )}

        {discovery && (
          <>
            <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 10px" }}>
              {discovery.fetched === 0 ? (
                <>
                  Nothing found for &ldquo;{discovery.query}&rdquo;. The phrase may not exist as posting vocabulary,
                  or the keyword may be narrowing it to nothing.
                </>
              ) : (
                <>
                  {discovery.titles.length} distinct title{discovery.titles.length === 1 ? "" : "s"} across{" "}
                  {discovery.fetched} posting{discovery.fetched === 1 ? "" : "s"}
                  {discovery.capped && (
                    <span style={{ color: T.GOLD }}> · sampled from {discovery.available} available</span>
                  )}
                  {discovery.untitled > 0 && (
                    <span style={{ color: T.DIM }}> · {discovery.untitled} with no core title</span>
                  )}
                </>
              )}
            </p>

            {discovery.titles.map((f) => (
              <div
                key={f.title}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "8px 0",
                  borderBottom: `1px solid ${T.BORDER_SOFT}`,
                  fontSize: 13,
                  color: T.TEXT,
                }}
              >
                <span style={{ flex: 1 }}>{f.title}</span>
                <span style={{ color: T.MUTED, fontSize: 12, minWidth: 28, textAlign: "right" }}>{f.count}</span>
                {f.already ? (
                  <span style={{ color: T.DIM, fontSize: 12, minWidth: 74, textAlign: "right" }}>on this lane</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => saveTitles([...lane.titles, f.title.toLowerCase()])}
                    disabled={saving}
                    style={{ ...btnSecondary, padding: "6px 12px", fontSize: 12, minWidth: 74 }}
                  >
                    add
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  )
}

function ConfigFact({ label, value, dim = false }: { label: string; value: string; dim?: boolean }) {
  return (
    <div>
      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 13, color: dim ? T.MUTED : T.TEXT }}>{value}</div>
    </div>
  )
}
