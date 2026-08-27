"use client"

// A lane's setup: what it searches for, how it filters, and how it is cleaned up.
//
// Titles, board filters, the years ceiling and the posting window are writable.
// Keyword and location are shown but not editable here, because each one can
// silently empty a lane and needs a guard the PATCH route does not have yet
// (app/api/lanes/[id]/route.ts). They are still shown, because you cannot judge
// a title without them: the same phrase searched with a keyword and without one
// returns different jobs, and a title that looks wrong is often a keyword that is.
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
import { authFetch, locationLabel, type Discovery, type LaneConfig, type LaneFilters } from "./laneApi"
import { BoardFiltersEditor, PostedWithinField, YearsMaxField } from "./LaneCriteria"

export function LaneTitleEditor({
  laneId,
  showConfig = true,
  onTitlesChange,
  onActiveChange,
  onRan,
  onQueueCleared,
  onDeleted,
}: {
  laneId: string
  showConfig?: boolean
  /** Fired after a successful save so a surrounding list can re-label itself. */
  onTitlesChange?: (titles: string[]) => void
  /** Fired after the lane is paused or resumed. */
  onActiveChange?: (active: boolean) => void
  /** Fired after a manual run, so a surrounding queue can reload. */
  onRan?: () => void
  /** Fired after the unreviewed queue is cleared. Same refresh a run needs. */
  onQueueCleared?: () => void
  /** Fired after the lane is deleted; it no longer exists when this runs. */
  onDeleted?: () => void
}) {
  const [lane, setLane] = useState<LaneConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Counts of what a delete would destroy, so the confirmation can name the
  // cost. Null until the lane loads.
  const [counts, setCounts] = useState<{ results: number; unreviewed: number; runs: number } | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Clearing the queue is the reversible-ish answer to a hundred stale rows, so
  // it gets its own confirmation rather than sharing the delete one.
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const [savingFilters, setSavingFilters] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  const [running, setRunning] = useState(false)
  // What just happened, whatever it was: a run, or a queue clear. One slot,
  // because they are two ways of finishing the same trip to this screen.
  const [notice, setNotice] = useState<string | null>(null)

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
      setCounts(j.counts ?? null)
      setConfirmingDelete(false)
      setConfirmingClear(false)
      setNotice(null)
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

  // Run now. The nightly sweep would get here eventually; this is for when the
  // titles just changed and nobody wants to wait until morning to see whether
  // the change was any good.
  const runNow = useCallback(async () => {
    setRunning(true)
    setNotice(null)
    setError(null)
    const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}/run`, { method: "POST" })
    const j = await res.json().catch(() => ({}))
    setRunning(false)
    if (!res.ok || !j.ok) {
      setError(j.error || "The run failed")
      return
    }
    // `found` counts everything the lane surfaced, `added` only what was new to
    // it. A healthy lane reports added 0 for days, so collapsing the two would
    // make a working lane look dead.
    const { found, added, refreshed } = j.run
    // The lane list holds the last-run line; it is now out of date.
    onRan?.()
    // The queue just grew, so the count the clear control names is stale.
    setCounts((prev) => (prev ? { ...prev, results: prev.results + added, unreviewed: prev.unreviewed + added } : prev))
    setNotice(
      `Found ${found} job${found === 1 ? "" : "s"} · ${added} new to this lane · ${refreshed} already here` +
        (j.was_paused ? " · lane is still paused, this run was manual" : "")
    )
  }, [laneId, onRan])

  // Two steps, and the second one names what goes. Pausing is the reversible
  // answer and sits three controls away; anyone reaching for this has already
  // decided the lane should not exist.
  const deleteLane = useCallback(async () => {
    setDeleting(true)
    setError(null)
    const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}`, { method: "DELETE" })
    const j = await res.json().catch(() => ({}))
    setDeleting(false)
    if (!res.ok || !j.ok) {
      setError(j.error || "Could not delete this lane")
      return
    }
    onDeleted?.()
  }, [laneId, onDeleted])

  // years_max and the posting window. One writer for both: they are two fields
  // on the same row and each save is a whole PATCH, so a second copy of this
  // would differ from the first the moment either one needed a fix.
  //
  // Optimistic like the rest of the screen, restoring only the keys it touched
  // rather than the whole lane, so a title save landing at the same moment is
  // not rolled back by this one failing.
  const saveConfig = useCallback(
    async (patch: { years_max?: number | null; days_posted?: number }) => {
      if (!lane) return
      const previous = { years_max: lane.years_max, days_posted: lane.days_posted }
      setLane({ ...lane, ...patch })
      setSavingConfig(true)
      const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      })
      setSavingConfig(false)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        setError(j.error || "Could not save that change")
        setLane((prev) => (prev ? { ...prev, ...previous } : prev))
        return
      }
      setError(null)
      setLane(j.lane)
    },
    [lane, laneId]
  )

  // Empty the queue without judging it. Rows are marked cleared rather than
  // deleted, so the next run refreshes them in place instead of putting them
  // straight back; see app/api/lanes/[id]/queue/route.ts. Anything already
  // pushed or dismissed is untouched, which is the whole point of clearing
  // rather than deleting the lane.
  const clearQueue = useCallback(async () => {
    setClearing(true)
    setError(null)
    const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}/queue`, { method: "DELETE" })
    const j = await res.json().catch(() => ({}))
    setClearing(false)
    if (!res.ok || !j.ok) {
      setError(j.error || "Could not clear the queue")
      return
    }
    setConfirmingClear(false)
    setCounts((prev) => (prev ? { ...prev, unreviewed: 0 } : prev))
    setNotice(`Cleared ${j.cleared} unreviewed job${j.cleared === 1 ? "" : "s"}. Reviewed rows were left alone.`)
    onQueueCleared?.()
  }, [laneId, onQueueCleared])

  // All four board filters save through one call, because they are one column
  // and PATCH replaces the object wholesale — a per-list write would have the
  // last one silently erase the others.
  const saveFilters = useCallback(
    async (next: LaneFilters) => {
      if (!lane) return
      const previous = lane.filters ?? {}
      setLane({ ...lane, filters: next })
      setSavingFilters(true)
      const res = await authFetch(`/api/lanes/${encodeURIComponent(laneId)}`, {
        method: "PATCH",
        body: JSON.stringify({ filters: next }),
      })
      setSavingFilters(false)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) {
        setError(j.error || "Could not save that filter change")
        setLane((prev) => (prev ? { ...prev, filters: previous } : prev))
        return
      }
      setError(null)
      setLane(j.lane)
    },
    [lane, laneId]
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

  const filters: LaneFilters = lane.filters ?? {}

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

      {/* What every search below is shaped by. Keyword and location are shown
          rather than editable; the two that are editable sit among them because
          a ceiling and a window are read the same way you read the rest. */}
      {showConfig && (
        <div
          style={{
            ...card, padding: "16px 18px", marginBottom: 14,
            display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start",
          }}
        >
          <ConfigFact label="Keyword" value={lane.keyword ?? "none"} dim={!lane.keyword} />
          <ConfigFact label="Location" value={locationLabel(lane.location)} />
          <YearsMaxField
            // Keyed on the saved value so the box re-seeds itself from the lane
            // whenever that changes, including a rollback. The alternative is an
            // effect mirroring a prop into state, which is the same thing with a
            // render in between.
            key={`years-max-${lane.years_max ?? "none"}`}
            value={lane.years_max}
            disabled={savingConfig}
            onCommit={(v) => saveConfig({ years_max: v })}
          />
          <PostedWithinField
            value={lane.days_posted}
            disabled={savingConfig}
            onChange={(v) => saveConfig({ days_posted: v })}
          />
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
          <div>
            <div style={{ ...eyebrow, color: T.DIM, marginBottom: 4 }}>Run</div>
            <button
              type="button"
              onClick={runNow}
              disabled={running || saving}
              title="Search the board for this lane now, instead of waiting for tonight"
              style={{
                background: "transparent",
                border: `1px solid ${T.BORDER}`,
                borderRadius: 999,
                padding: "3px 12px",
                fontSize: 12,
                fontWeight: 800,
                cursor: running || saving ? "not-allowed" : "pointer",
                color: running ? T.DIM : T.WRN_BLUE,
              }}
            >
              {running ? "Running…" : "Run now"}
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div
          style={{
            ...card, padding: "10px 14px", marginBottom: 14,
            borderColor: T.SUCCESS, background: T.SUCCESS_BG, color: T.TEXT, fontSize: 13,
          }}
        >
          {notice}
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

      <section style={{ ...card, padding: "18px 20px", marginBottom: 14 }}>
        <BoardFiltersEditor
          filters={filters}
          disabled={savingFilters}
          saving={savingFilters}
          onChange={saveFilters}
        />
      </section>

      <section style={{ ...card, padding: "18px 20px", marginBottom: 14 }}>
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

      {/* Deliberately last, and visually separate. Pausing is the reversible
          answer to "stop this lane" and lives up in the config strip; these are
          the other two questions, in increasing order of how much they cost.
          Clearing empties the queue and keeps everything else; deleting keeps
          nothing. */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        {!confirmingClear && !confirmingDelete && (
          <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setConfirmingClear(true)}
              disabled={counts?.unreviewed === 0}
              title={
                counts?.unreviewed === 0
                  ? "Nothing is waiting to be reviewed"
                  : "Take every unreviewed job out of the queue, keeping the lane and everything already reviewed"
              }
              style={{
                background: "none", border: "none", padding: 0,
                color: counts?.unreviewed === 0 ? T.DIM : T.MUTED,
                fontSize: 12, fontWeight: 700,
                cursor: counts?.unreviewed === 0 ? "not-allowed" : "pointer",
              }}
            >
              Clear the unreviewed queue
              {counts ? ` (${counts.unreviewed})` : ""}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              style={{
                background: "none", border: "none", padding: 0,
                color: T.MUTED, fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              Delete this lane
            </button>
          </div>
        )}

        {confirmingClear && (
          <div style={{ ...card, padding: "14px 16px", borderColor: T.ORANGE_BORDER, background: T.WARNING_BG }}>
            <p style={{ fontSize: 13, color: T.TEXT, margin: "0 0 4px", fontWeight: 700 }}>
              {counts
                ? `Clear ${counts.unreviewed} unreviewed job${counts.unreviewed === 1 ? "" : "s"} from this queue?`
                : "Clear every unreviewed job from this queue?"}
            </p>
            <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 12px" }}>
              The lane keeps running, and everything you have already scored or dismissed stays exactly as it is.
              Cleared jobs are marked, not deleted, so tonight&apos;s run refreshes them in place instead of putting
              them straight back in the queue.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                onClick={clearQueue}
                disabled={clearing}
                style={{
                  ...btnSecondary, padding: "9px 16px",
                  cursor: clearing ? "not-allowed" : "pointer", opacity: clearing ? 0.6 : 1,
                }}
              >
                {clearing ? "Clearing…" : "Clear the queue"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingClear(false)}
                disabled={clearing}
                style={{ background: "transparent", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {confirmingDelete && (
          <div style={{ ...card, padding: "14px 16px", borderColor: T.ERROR, background: T.ERROR_BG }}>
            <p style={{ fontSize: 13, color: T.TEXT, margin: "0 0 4px", fontWeight: 700 }}>
              Delete &ldquo;{lane.name}&rdquo; permanently?
            </p>
            <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 12px" }}>
              {counts
                ? `This also deletes ${counts.results} saved result${counts.results === 1 ? "" : "s"} and ${counts.runs} run record${counts.runs === 1 ? "" : "s"}, including anything still unreviewed. There is no undo.`
                : "This also deletes every saved result and run record for the lane. There is no undo."}{" "}
              To stop it running without losing any of that, pause it instead.
            </p>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                type="button"
                onClick={deleteLane}
                disabled={deleting}
                style={{
                  background: T.ERROR, color: "#1a0505", border: "none", borderRadius: 11,
                  padding: "9px 16px", fontSize: 13, fontWeight: 900,
                  cursor: deleting ? "not-allowed" : "pointer", opacity: deleting ? 0.6 : 1,
                }}
              >
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                style={{ background: "transparent", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
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
