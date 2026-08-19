"use client"

// The whole lane surface: pick a lane, edit its titles, work its queue.
//
// One component, two mounts. /dashboard/lanes mounts it unscoped, so it lists
// every lane the caller may see — their own plus every client they coach — and
// labels each tab with whose it is. A coach's client record mounts it with that
// client's profile id, so it lists only that client's lanes and drops the name
// from the tabs, where it would otherwise repeat on every one.
//
// Scoping is enforced server-side, not here: passing clientProfileId only asks
// for a narrower list, and asking for someone you do not coach is a 403 rather
// than an empty list (app/api/lanes/route.ts).
//
// Rows are removed optimistically and restored if the write fails. A queue that
// re-renders the row you just judged is the fastest way to lose your place in a
// list of seventy, so the removal has to happen on click, not on response.
//
// Scoring is not a decision and writes nothing: the row stays in the queue until
// something is actually sent to the client's tracker. Only Dismiss removes a row
// here.
//
// Where Score goes depends on who is mounting this. Inside a client record the
// parent owns the Source a Job tab, so it passes onScore and switches tab in
// place — instant, and the queue is still there when you come back. On the
// all-clients page there is no such tab, so Score navigates to the client's
// record with the job carried in the query string. The lane result id goes along
// too, so that a successful send can mark the row it came from.

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { T, card, eyebrow } from "../../../lib/dashboard-theme"
import { LaneResultRow } from "./LaneResultRow"
import { LaneTitleEditor } from "./LaneTitleEditor"
import { CreateLanePanel } from "./CreateLanePanel"
import { authFetch, laneTabLabel, lastRunLabel, type LaneSummary, type Result } from "./laneApi"

export function LanesPanel({
  clientProfileId = null,
  emptyHint,
  clientName,
  onScore,
}: {
  /** Narrow to one owner. Null lists everything in the caller's scope. */
  clientProfileId?: string | null
  /** What to say when there are no lanes; the caller knows whose screen this is. */
  emptyHint?: string
  /** Whose record this is, for the create panel's copy. */
  clientName?: string | null
  /**
   * Handle Score in place. Given when the mounting page owns a Source a Job tab.
   * Without it, Score navigates to the client record instead.
   */
  onScore?: (args: { row: Result; laneResultId: string; clientProfileId: string }) => void
}) {
  const router = useRouter()
  // A list that spans people needs the owner on each tab; a single client's
  // record does not, because it would be the same name every time.
  const showClientNames = clientProfileId === null

  const [lanes, setLanes] = useState<LaneSummary[] | null>(null)
  const [profile, setProfile] = useState<{ id: string; name?: string | null; email?: string | null } | null>(null)
  const [laneId, setLaneId] = useState<string | null>(null)
  const [results, setResults] = useState<Result[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)

  // Bumped after a lane is created, to re-read the list.
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let live = true
    ;(async () => {
      setLoading(true)
      const qs = clientProfileId ? `?client_profile_id=${encodeURIComponent(clientProfileId)}` : ""
      const res = await authFetch(`/api/lanes${qs}`)
      const j = await res.json().catch(() => ({}))
      if (!live) return
      if (!res.ok || !j.ok) {
        setError(j.error || "Could not load lanes")
        setLanes(null)
        setLoading(false)
        return
      }
      setError(null)
      setLanes(j.lanes || [])
      setProfile(j.profile ?? null)
      setLaneId((j.lanes || [])[0]?.id ?? null)
      setLoading(false)
    })()
    return () => {
      live = false
    }
  }, [clientProfileId, reloadKey])

  const loadQueue = useCallback(async (id: string) => {
    setResults(null)
    const res = await authFetch(`/api/lanes/results?lane_id=${encodeURIComponent(id)}`)
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j.ok) {
      setError(j.error || "Could not load the queue")
      return
    }
    setError(null)
    setResults(j.results || [])
  }, [])

  useEffect(() => {
    if (laneId) loadQueue(laneId)
  }, [laneId, loadQueue])

  const dismiss = useCallback(
    async (row: Result, reason: string, note: string | null) => {
      const index = results?.findIndex((r) => r.id === row.id) ?? -1
      setResults((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev))
      setLanes((prev) =>
        prev ? prev.map((l) => (l.id === laneId ? { ...l, unreviewed: Math.max(0, l.unreviewed - 1) } : l)) : prev
      )

      const res = await authFetch("/api/lanes/results", {
        method: "PATCH",
        body: JSON.stringify({ id: row.id, action: "dismiss", reason, note }),
      })
      if (res.ok) return

      // Put it back exactly where it was — dropping it at the end would move
      // the row the reviewer is still looking at.
      const j = await res.json().catch(() => ({}))
      setError(j.error || "Could not save that. The row is back in the queue.")
      setResults((prev) => {
        if (!prev) return prev
        const next = [...prev]
        next.splice(index < 0 ? next.length : index, 0, row)
        return next
      })
      setLanes((prev) =>
        prev ? prev.map((l) => (l.id === laneId ? { ...l, unreviewed: l.unreviewed + 1 } : l)) : prev
      )
    },
    [results, laneId]
  )

  // Score: carry the job to the scoring screen. No write — see the header.
  const score = useCallback(
    (row: Result) => {
      const owner = lanes?.find((l) => l.id === laneId)?.client_profile_id
      if (!owner) return
      if (onScore) {
        onScore({ row, laneResultId: row.id, clientProfileId: owner })
        return
      }
      // The JD box is deliberately left empty: the board never gives us a job
      // description (its longest text field is a 194-character summary), and
      // scoring a summary would produce a real-looking score off two sentences.
      const qs = new URLSearchParams({
        tab: "source",
        sc_title: row.title ?? "",
        sc_company: row.company ?? "",
        sc_url: row.apply_url ?? "",
        lane_result: row.id,
      })
      router.push(`/dashboard/coach/clients/${owner}?${qs.toString()}`)
    },
    [lanes, laneId, onScore, router]
  )

  // Titles changed under us, so the tab's title count is stale and the queue may
  // gain rows on the next run. Refresh the lane row, not the queue: nothing new
  // is fetched from the board until someone runs the lane.
  const onTitlesChange = useCallback(
    (titles: string[]) => {
      setLanes((prev) => (prev ? prev.map((l) => (l.id === laneId ? { ...l, titles } : l)) : prev))
    },
    [laneId]
  )

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading lanes…</p>

  const lane = lanes?.find((l) => l.id === laneId) ?? null

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
            marginBottom: 18,
          }}
        >
          {error}
        </div>
      )}

      {lanes === null ? (
        <div style={{ ...card, padding: 32 }}>
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            Couldn&apos;t load lanes. Reload to try again.
          </p>
        </div>
      ) : lanes.length === 0 && clientProfileId ? (
        <CreateLanePanel
          clientProfileId={clientProfileId}
          clientName={clientName}
          onCreated={() => setReloadKey((k) => k + 1)}
        />
      ) : lanes.length === 0 ? (
        <div style={{ ...card, padding: 32 }}>
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            {emptyHint || "No lanes here yet. Create one and run it to fill this queue."}
          </p>
          {showClientNames && profile && (
            <p style={{ color: T.DIM, fontSize: 12, margin: "10px 0 0" }}>
              Signed in as{" "}
              <strong style={{ color: T.MUTED }}>{profile.name || profile.email || profile.id}</strong>
              {profile.name && profile.email ? ` · ${profile.email}` : ""}
              {" · "}
              <span style={{ fontFamily: "ui-monospace, monospace" }}>{profile.id}</span>
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Lane picker. Tabs rather than a dropdown: the unreviewed count is
              the reason you'd switch, so it has to be visible before you do. */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
            {lanes.map((l) => {
              const on = l.id === laneId
              return (
                <button
                  key={l.id}
                  onClick={() => {
                    setLaneId(l.id)
                    // Collapse on switch: an editor left open would show the new
                    // lane's titles under the previous lane's heading for as
                    // long as the config takes to load.
                    setEditorOpen(false)
                  }}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "9px 14px", borderRadius: 12, cursor: "pointer",
                    fontSize: 13, fontWeight: 700,
                    background: on ? T.GLASS : "transparent",
                    border: `1px solid ${on ? T.ORANGE_BORDER : T.BORDER_SOFT}`,
                    color: on ? T.TEXT : T.MUTED,
                  }}
                >
                  {laneTabLabel(l, showClientNames)}
                  {!l.active && (
                    <span style={{ fontSize: 10, fontWeight: 900, color: T.WRN_ORANGE, letterSpacing: 0.4 }}>
                      PAUSED
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 11, fontWeight: 900,
                      color: l.unreviewed ? T.WRN_ORANGE : T.DIM,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {l.unreviewed}
                  </span>
                </button>
              )
            })}
          </div>

          {/* When this lane last ran. A queue with nothing in it means one of
              two very different things — the lane found nothing, or the lane
              stopped running — and only this line tells them apart. */}
          {lane && (
            <p
              style={{
                fontSize: 12,
                color: lane.last_run?.status === "error" ? T.ERROR : T.DIM,
                margin: "-8px 0 14px",
              }}
            >
              Last run: {lastRunLabel(lane.last_run)}
              {lane.last_run?.trigger === "manual" ? " (run by hand)" : ""}
              {lane.last_run?.error ? ` — ${lane.last_run.error.slice(0, 90)}` : ""}
              {!lane.active && " · paused, so it will not run tonight"}
            </p>
          )}

          {/* Titles and discovery, collapsed by default. The queue is the reason
              you came; editing what feeds it is the occasional trip. */}
          {laneId && (
            <div style={{ marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => setEditorOpen((v) => !v)}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  background: "transparent", border: `1px dashed ${T.BORDER_SOFT}`,
                  borderRadius: 12, padding: "10px 14px", cursor: "pointer",
                  color: T.MUTED, fontSize: 12, fontWeight: 800, textAlign: "left",
                }}
              >
                <span style={{ color: T.DIM }}>{editorOpen ? "▾" : "▸"}</span>
                Titles &amp; discovery
                {lane && (
                  <span style={{ color: T.DIM, fontWeight: 600 }}>
                    · {lane.titles.length} title{lane.titles.length === 1 ? "" : "s"}
                    {lane.keyword ? ` · keyword “${lane.keyword}”` : ""}
                  </span>
                )}
              </button>
              {editorOpen && (
                <div style={{ marginTop: 12 }}>
                  <LaneTitleEditor
                    laneId={laneId}
                    onTitlesChange={onTitlesChange}
                    onActiveChange={(active) =>
                      setLanes((prev) => (prev ? prev.map((l) => (l.id === laneId ? { ...l, active } : l)) : prev))
                    }
                    onRan={() => {
                      // The queue below just changed underneath us, and so did
                      // the tab's unreviewed count.
                      if (laneId) loadQueue(laneId)
                      setReloadKey((k) => k + 1)
                    }}
                    onDeleted={() => {
                      // The selected lane is gone. Drop the selection and reload
                      // so the tabs, the queue and the create panel all reflect
                      // a lane list that no longer contains it.
                      setLaneId(null)
                      setResults(null)
                      setEditorOpen(false)
                      setReloadKey((k) => k + 1)
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {results === null ? (
            <p style={{ color: T.MUTED, fontSize: 13 }}>Loading queue…</p>
          ) : results.length === 0 ? (
            <div style={{ ...card, padding: 32 }}>
              <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 8 }}>Queue clear</div>
              <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
                Every job {lane?.name ? `in ${lane.name}` : "in this lane"} has been reviewed. Re-run the lane to
                pull in anything new.
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {results.map((r) => (
                <LaneResultRow
                  key={r.id}
                  row={r}
                  canSend={lane?.can_send ?? false}
                  onScore={score}
                  onDismiss={dismiss}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
