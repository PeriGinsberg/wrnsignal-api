"use client"

// The Resume Workshop: the coach's live note-taking workspace for one client,
// in place of a Google Doc. Coach only. Opened from the client's page ("Resume
// Workshop ↗"), keyed by the coaching relationship.
//
// LAYOUT, for a live conversation. Left: the nine discovery tabs, each with a
// collapsed Coach's Exploration Guide and any number of entries (a title and
// one large notes field). Right, independently scrollable and collapsible:
// Quick Capture (always at the top) and, below it, the client's resume on file
// or the consultation. Every field autosaves (AutoField). Export Workshop Notes
// saves anything pending, then downloads the Markdown the server builds.
//
// Keyboard: Alt+1 to Alt+9 switch tabs, Alt+0 general notes, Alt+Q jumps to
// Quick Capture.

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { T, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { TABS, TAB_LABEL, TITLE_PLACEHOLDER, GUIDES, type WorkshopTab } from "@/lib/resumeWorkshop/model"
import { SEARCH_GOAL_LABEL, SERVICE_LABEL, MATERIAL_STATE_LABEL } from "@/lib/prospects/model"
import { AutoField, type FieldStatus, type Registry, type SaveResult } from "./AutoField"

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

type Workshop = { id: string; workshop_date: string; general_notes: string; general_version: number; pasted_resume_text: string | null }
type Entry = { id: string; tab: WorkshopTab; title: string; title_version: number; notes: string; notes_version: number; source: "coach" | "resume"; resume_excerpt: string | null; rev?: number }
type Capture = { id: string; body: string; body_version: number; copied_to_entry_id: string | null; moved_to_entry_id: string | null; created_at: string; rev?: number }
type Resume = { source: "persona" | "profile" | "pasted" | null; label: string | null; text: string | null }
type Consult = {
  consult: Record<string, unknown> | null
  targets: { roles: unknown; industries: unknown; locations: unknown }
  engagements: { name: string; status: string; deliverables: string[] }[]
  booking_form: Record<string, unknown> | null
}
type Bundle = { client_name: string; workshop: Workshop | null; entries: Entry[]; captures: Capture[]; resume: Resume; consult: Consult }
type View = WorkshopTab | "general"
// The API's JSON body. Shapes are checked where each action's data is used.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiJson = any
type Post = (b: Record<string, unknown>) => Promise<{ res: Response; j: ApiJson }>

const STATUS_TEXT: Record<"saving" | "saved" | "error" | "pending", string> = {
  pending: "Saving...", saving: "Saving...", saved: "All changes saved", error: "Some changes are not saved",
}

export default function ResumeWorkshopPage({ params }: { params: Promise<{ coachClientId: string }> }) {
  const { coachClientId } = use(params)
  const api = `/api/coach/coach-clients/${encodeURIComponent(coachClientId)}/resume-workshop`

  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [view, setView] = useState<View>("experience")
  const [sideOpen, setSideOpen] = useState(true)
  const [sideView, setSideView] = useState<"resume" | "consult">("resume")
  const [exporting, setExporting] = useState(false)

  // ── Autosave registry: one status for the page, flush-all for export ──
  const fields = useRef(new Map<string, { flush: () => Promise<void> }>())
  const statuses = useRef(new Map<string, FieldStatus>())
  const [overall, setOverall] = useState<"saving" | "saved" | "error" | "pending" | "idle">("idle")
  const recompute = useCallback(() => {
    const all = [...statuses.current.values()]
    setOverall(all.some((s) => s === "error" || s === "conflict") ? "error"
      : all.some((s) => s === "saving") ? "saving"
      : all.some((s) => s === "pending") ? "pending"
      : all.some((s) => s === "saved") ? "saved" : "idle")
  }, [])
  const registry: Registry = useMemo(() => ({
    register: (id, f) => { fields.current.set(id, f) },
    unregister: (id) => { fields.current.delete(id); statuses.current.delete(id); recompute() },
    report: (id, s) => { statuses.current.set(id, s); recompute() },
  }), [recompute])
  const flushAll = useCallback(async () => {
    await Promise.all([...fields.current.values()].map((f) => f.flush()))
  }, [])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      const unsaved = [...statuses.current.values()].some((s) => s === "pending" || s === "saving" || s === "error" || s === "conflict")
      if (unsaved) { e.preventDefault(); e.returnValue = "" }
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [])

  // ── Loading; the first open creates the workshop ──
  const load = useCallback(async () => {
    try {
      let res = await authFetch(api)
      let j = await res.json().catch(() => ({}))
      if (res.ok && j.ok && !j.workshop) {
        const s = await authFetch(api, { method: "POST", body: JSON.stringify({ action: "start" }) })
        const sj = await s.json().catch(() => ({}))
        if (!s.ok || !sj.ok) { setLoadError(sj.error || `Couldn't start the workshop (${s.status})`); return }
        res = await authFetch(api)
        j = await res.json().catch(() => ({}))
      }
      if (!res.ok || !j.ok) { setLoadError(j.error || `Couldn't load the workshop (${res.status})`); return }
      setBundle(j as Bundle)
      if (!(j as Bundle).resume.text) setSideView("resume")
    } catch {
      setLoadError("Network error. Check your connection and reload.")
    }
  }, [api])
  useEffect(() => { void load() }, [load])

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await authFetch(api, { method: "POST", body: JSON.stringify(body) })
    const j = await res.json().catch(() => ({}))
    return { res, j }
  }, [api])

  // ── Keyboard: Alt+1..9, Alt+0, Alt+Q ──
  const captureInput = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return
      if (/^[1-9]$/.test(e.key)) { e.preventDefault(); setView(TABS[Number(e.key) - 1]) }
      else if (e.key === "0") { e.preventDefault(); setView("general") }
      else if (e.key.toLowerCase() === "q") { e.preventDefault(); setSideOpen(true); setTimeout(() => captureInput.current?.focus(), 0) }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  if (loadError) {
    return <Shell><p role="alert" style={{ color: T.ERROR, fontSize: 16 }}>{loadError}</p></Shell>
  }
  if (!bundle || !bundle.workshop) {
    return <Shell><p style={{ color: T.MUTED, fontSize: 16 }}>Opening the Resume Workshop...</p></Shell>
  }

  const ws = bundle.workshop
  const entries = bundle.entries
  const setEntries = (f: (es: Entry[]) => Entry[]) => setBundle((b) => (b ? { ...b, entries: f(b.entries) } : b))
  const setCaptures = (f: (cs: Capture[]) => Capture[]) => setBundle((b) => (b ? { ...b, captures: f(b.captures) } : b))

  const saveEntry = (entry: Entry, field: "title" | "notes") => async (value: string, base: number): Promise<SaveResult> => {
    const { res, j } = await post({ action: "save_entry", entry_id: entry.id, field, value, base_version: base })
    if (res.ok && j.ok) {
      const e = j.data as Entry
      setEntries((es) => es.map((x) => (x.id === e.id ? { ...x, [field]: e[field], [`${field}_version`]: e[`${field}_version`] } : x)))
      return { ok: true, value: e[field], version: e[`${field}_version`] }
    }
    const cur = j.current as Entry | null
    return { ok: false, status: res.status, error: j.error || "Save failed", current: cur ? { value: cur[field], version: cur[`${field}_version`] } : null }
  }

  const addEntry = async (tab: WorkshopTab) => {
    setActionError(null)
    const { res, j } = await post({ action: "add_entry", tab })
    if (!res.ok || !j.ok) { setActionError(j.error || "Couldn't add the entry."); return }
    setEntries((es) => [...es, j.data as Entry])
    setTimeout(() => document.getElementById(`entry-title-${(j.data as Entry).id}`)?.focus(), 50)
  }

  const deleteEntry = async (entry: Entry) => {
    setActionError(null)
    await fields.current.get(`entry-notes-${entry.id}`)?.flush()
    const { res, j } = await post({ action: "delete_entry", entry_id: entry.id })
    if (!res.ok || !j.ok) { setActionError(j.error || "Couldn't delete the entry."); return }
    setEntries((es) => es.filter((x) => x.id !== entry.id))
  }

  const exportNotes = async () => {
    setExporting(true)
    setActionError(null)
    try {
      await flushAll()
      const unsaved = [...statuses.current.values()].some((s) => s === "error" || s === "conflict")
      if (unsaved) setActionError("Some text could not be saved, so the export may not include it. Check the fields marked in red.")
      const res = await authFetch(`${api}/export`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setActionError(j.error || `Export failed (${res.status})`)
        return
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "Resume-Workshop.md"
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      setActionError("Export failed: network error. Your notes are saved; try again.")
    } finally {
      setExporting(false)
    }
  }

  const counts = Object.fromEntries(TABS.map((t) => [t, entries.filter((e) => e.tab === t).length])) as Record<WorkshopTab, number>
  const statusShown = overall === "idle" ? "saved" : overall

  return (
    <div style={{ color: T.TEXT, maxWidth: 1600, margin: "0 auto" }}>
      <style>{CSS}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <a href={`/dashboard/coach`} onClick={(e) => { if (history.length > 1) { e.preventDefault(); history.back() } }}
            style={{ color: T.MUTED, fontSize: 13, fontWeight: 700, textDecoration: "none" }}>&larr; Back</a>
          <h1 style={{ margin: "4px 0 0", fontSize: 26, fontWeight: 900, letterSpacing: -0.3 }}>
            Resume Workshop: {bundle.client_name}
          </h1>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: T.MUTED, fontWeight: 700 }}>
          Workshop date
          <input type="date" defaultValue={ws.workshop_date}
            onChange={async (e) => {
              if (!e.target.value) return
              const { res, j } = await post({ action: "date", value: e.target.value })
              if (!res.ok || !j.ok) setActionError(j.error || "Couldn't save the date.")
            }}
            style={{ fontFamily: "inherit", fontSize: 14, padding: "6px 8px", borderRadius: 8, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT, colorScheme: "light" }} />
        </label>
        <span role="status" aria-live="polite" style={{
          fontSize: 14, fontWeight: 800, minWidth: 150, textAlign: "right",
          color: statusShown === "error" ? T.ERROR : T.MUTED,
        }}>
          {STATUS_TEXT[statusShown]}
        </span>
        <button type="button" onClick={() => void exportNotes()} disabled={exporting}
          style={{ ...btnPrimary, opacity: exporting ? 0.6 : 1, fontSize: 15 }}>
          {exporting ? "Exporting..." : "Export Workshop Notes"}
        </button>
      </div>

      {actionError && (
        <div role="alert" style={{ marginBottom: 12, padding: "10px 14px", borderRadius: 10, background: T.ERROR_BG, border: `1px solid ${T.ERROR_BORDER}`, color: T.TEXT, fontSize: 14 }}>
          {actionError}
        </div>
      )}

      {/* Tabs */}
      <div role="tablist" aria-label="Discovery tabs" className="rw-tabs">
        {TABS.map((t, i) => (
          <button key={t} role="tab" aria-selected={view === t} onClick={() => setView(t)} title={`Alt+${i + 1}`}
            className={`rw-tab${view === t ? " rw-tab-on" : ""}`}>
            {TAB_LABEL[t]}
            {counts[t] > 0 && <span className="rw-count">{counts[t]}</span>}
          </button>
        ))}
        <button role="tab" aria-selected={view === "general"} onClick={() => setView("general")} title="Alt+0"
          className={`rw-tab rw-tab-general${view === "general" ? " rw-tab-on" : ""}`}>
          General notes
        </button>
      </div>

      <div className={`rw-grid${sideOpen ? "" : " rw-grid-closed"}`}>
        {/* Main column */}
        <main style={{ minWidth: 0 }}>
          {/* Every view stays mounted (only hidden), so switching never drops a field mid-save. */}
          <section aria-label="General workshop notes" hidden={view !== "general"}>
              <p style={{ color: T.MUTED, fontSize: 14, margin: "0 0 10px" }}>
                Anything about the workshop as a whole: goals the client named, themes, next steps.
              </p>
              <AutoField id="general" registry={registry} multiline minRows={18} ariaLabel="General workshop notes"
                value={ws.general_notes} version={ws.general_version}
                save={async (value, base) => {
                  const { res, j } = await post({ action: "general", value, base_version: base })
                  if (res.ok && j.ok) return { ok: true, value: j.data.general_notes, version: j.data.general_version }
                  return { ok: false, status: res.status, error: j.error, current: j.current ? { value: j.current.general_notes, version: j.current.general_version } : null }
                }} />
          </section>
          {view !== "general" && (
            <section aria-label={TAB_LABEL[view]}>
              <Guide tab={view} />
            </section>
          )}
          <div hidden={view === "general"}>
              {TABS.map((t) => (
                <div key={t} hidden={t !== view}>
                  {entries.filter((e) => e.tab === t).length === 0 && (
                    <p style={{ color: T.MUTED, fontSize: 15, margin: "16px 0" }}>No entries yet.</p>
                  )}
                  {entries.filter((e) => e.tab === t).map((e) => (
                    <EntryCard key={e.id} entry={e} registry={registry}
                      saveTitle={saveEntry(e, "title")} saveNotes={saveEntry(e, "notes")}
                      onDelete={() => deleteEntry(e)} />
                  ))}
                  <button type="button" onClick={() => void addEntry(t)} style={{ ...btnSecondary, marginTop: 6 }}>
                    + Add {TAB_LABEL[t]} entry
                  </button>
                </div>
              ))}
          </div>
        </main>

        {/* Side panel */}
        <aside className="rw-side" aria-label="Quick Capture and reference">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ fontSize: 13, letterSpacing: 0.6, textTransform: "uppercase", color: T.MUTED }}>Quick Capture</strong>
            <button type="button" onClick={() => setSideOpen((v) => !v)} className="rw-link">{sideOpen ? "Hide panel" : "Show panel"}</button>
          </div>
          {sideOpen && (
            <>
              <QuickCapture captures={bundle.captures} entries={entries} registry={registry} inputRef={captureInput}
                post={post} fields={fields.current}
                onAdded={(c) => setCaptures((cs) => [...cs, c])}
                onChanged={(c) => setCaptures((cs) => cs.map((x) => (x.id === c.id ? { ...x, ...c, rev: (x.rev ?? 0) + 1 } : x)))}
                onDeleted={(id) => setCaptures((cs) => cs.filter((x) => x.id !== id))}
                onEntryChanged={(e) => setEntries((es) => es.map((x) => (x.id === e.id ? { ...x, notes: e.notes, notes_version: e.notes_version, rev: (x.rev ?? 0) + 1 } : x)))}
                onError={setActionError} />

              <div role="tablist" aria-label="Reference" style={{ display: "flex", gap: 6, margin: "18px 0 10px" }}>
                <button role="tab" aria-selected={sideView === "resume"} onClick={() => setSideView("resume")} className={`rw-tab rw-tab-sm${sideView === "resume" ? " rw-tab-on" : ""}`}>Original resume</button>
                <button role="tab" aria-selected={sideView === "consult"} onClick={() => setSideView("consult")} className={`rw-tab rw-tab-sm${sideView === "consult" ? " rw-tab-on" : ""}`}>Consultation</button>
              </div>
              {sideView === "resume"
                ? <ResumePanel resume={bundle.resume} hasResumeEntries={entries.some((e) => e.source === "resume")} post={post}
                    onChanged={() => void load()} onError={setActionError} />
                : <ConsultPanel consult={bundle.consult} />}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 900, margin: "40px auto", color: T.TEXT }}>{children}</div>
}

function Guide({ tab }: { tab: WorkshopTab }) {
  const g = GUIDES[tab]
  return (
    <details className="rw-guide" key={tab}>
      <summary>Coach&apos;s Exploration Guide</summary>
      <div style={{ padding: "6px 4px 2px" }}>
        <p style={{ margin: "0 0 10px", fontSize: 14, color: T.TEXT }}>{g.intro}</p>
        {g.sections.map((s) => (
          <div key={s.heading} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.TEXT }}>{s.heading}</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 14, color: T.TEXT, lineHeight: 1.5 }}>
              {s.prompts.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ))}
        {g.reminders.length > 0 && (
          <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13, color: T.MUTED, lineHeight: 1.5 }}>
            {g.reminders.map((r) => <li key={r}>{r}</li>)}
          </ul>
        )}
      </div>
    </details>
  )
}

function EntryCard({ entry, registry, saveTitle, saveNotes, onDelete }: {
  entry: Entry
  registry: Registry
  saveTitle: (v: string, b: number) => Promise<SaveResult>
  saveNotes: (v: string, b: number) => Promise<SaveResult>
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <article className="rw-entry">
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <AutoField id={`entry-title-${entry.id}`} registry={registry} value={entry.title} version={entry.title_version}
            save={saveTitle} ariaLabel="Entry title" placeholder={TITLE_PLACEHOLDER[entry.tab]}
            style={{ fontSize: 17, fontWeight: 800 }} />
        </div>
        {confirming ? (
          <span style={{ display: "flex", gap: 10, alignItems: "center", flexShrink: 0, paddingTop: 8 }}>
            <span style={{ fontSize: 13, color: T.TEXT }}>Delete this entry and its notes?</span>
            <button type="button" className="rw-link rw-danger" disabled={busy}
              onClick={async () => { setBusy(true); await onDelete(); setBusy(false) }}>Delete</button>
            <button type="button" className="rw-link" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button type="button" className="rw-link" style={{ flexShrink: 0, paddingTop: 10 }} onClick={() => setConfirming(true)}
            aria-label={`Delete entry ${entry.title || "untitled"}`}>Delete</button>
        )}
      </div>
      {entry.resume_excerpt && (
        <details className="rw-excerpt" open>
          <summary>From the original resume (imported, read-only)</summary>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.5, color: T.TEXT, maxHeight: 260, overflowY: "auto", padding: "6px 2px 2px" }}>
            {entry.resume_excerpt}
          </div>
        </details>
      )}
      <div style={{ marginTop: 8 }}>
        <AutoField id={`entry-notes-${entry.id}`} registry={registry} multiline minRows={8}
          value={entry.notes} version={entry.notes_version} revision={entry.rev}
          save={saveNotes} ariaLabel={`Notes for ${entry.title || "this entry"}`}
          placeholder="Coach notes. Type freely." />
      </div>
    </article>
  )
}

function QuickCapture({ captures, entries, registry, inputRef, post, fields, onAdded, onChanged, onDeleted, onEntryChanged, onError }: {
  captures: Capture[]
  entries: Entry[]
  registry: Registry
  inputRef: React.MutableRefObject<HTMLTextAreaElement | null>
  post: Post
  fields: Map<string, { flush: () => Promise<void> }>
  onAdded: (c: Capture) => void
  onChanged: (c: Capture) => void
  onDeleted: (id: string) => void
  onEntryChanged: (e: Entry) => void
  onError: (m: string | null) => void
}) {
  const [draft, setDraft] = useState("")
  const [adding, setAdding] = useState(false)
  const [showMoved, setShowMoved] = useState(false)
  const active = captures.filter((c) => !c.moved_to_entry_id)
  const moved = captures.filter((c) => c.moved_to_entry_id)
  const entryLabel = (id: string | null) => {
    const e = entries.find((x) => x.id === id)
    return e ? `${TAB_LABEL[e.tab]}: ${e.title || "untitled"}` : "a deleted entry"
  }

  const add = async () => {
    // Read the box itself, not state: a click right after typing can run
    // before the last keystroke's render.
    const body = inputRef.current?.value ?? draft
    if (!body.trim() || adding) return
    setAdding(true)
    const { res, j } = await post({ action: "add_capture", body })
    setAdding(false)
    if (!res.ok || !j.ok) { onError(j.error || "Couldn't save the note."); return }
    onError(null)
    setDraft("")
    onAdded(j.data as Capture)
    inputRef.current?.focus()
  }

  return (
    <div>
      <textarea ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} rows={3}
        aria-label="New Quick Capture note"
        placeholder="Jot something down. Ctrl+Enter to add."
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void add() } }}
        style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 15, lineHeight: 1.5, padding: "8px 10px", borderRadius: 10, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT, resize: "vertical" }} />
      <button type="button" onClick={() => void add()} disabled={!draft.trim() || adding} style={{ ...btnSecondary, marginTop: 6, opacity: !draft.trim() || adding ? 0.55 : 1 }}>
        {adding ? "Adding..." : "Add note"}
      </button>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        {active.length === 0 && <p style={{ fontSize: 14, color: T.MUTED, margin: 0 }}>No captured notes yet.</p>}
        {[...active].reverse().map((c) => (
          <CaptureItem key={c.id} capture={c} entries={entries} registry={registry} post={post} fields={fields}
            entryLabel={entryLabel} onChanged={onChanged} onDeleted={onDeleted} onEntryChanged={onEntryChanged} onError={onError} />
        ))}
      </div>

      {moved.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="rw-link" onClick={() => setShowMoved((v) => !v)}>
            {showMoved ? "Hide" : "Show"} {moved.length} moved {moved.length === 1 ? "note" : "notes"}
          </button>
          {showMoved && moved.map((c) => (
            <div key={c.id} style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: `1px dashed ${T.BORDER}`, fontSize: 14 }}>
              <div style={{ fontSize: 12, color: T.MUTED, marginBottom: 4 }}>Moved into {entryLabel(c.moved_to_entry_id)}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CaptureItem({ capture, entries, registry, post, fields, entryLabel, onChanged, onDeleted, onEntryChanged, onError }: {
  capture: Capture
  entries: Entry[]
  registry: Registry
  post: Post
  fields: Map<string, { flush: () => Promise<void> }>
  entryLabel: (id: string | null) => string
  onChanged: (c: Capture) => void
  onDeleted: (id: string) => void
  onEntryChanged: (e: Entry) => void
  onError: (m: string | null) => void
}) {
  const [target, setTarget] = useState("")
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const send = async (mode: "copy" | "move") => {
    if (!target) return
    setBusy(true)
    // Save what is typed in the note and in the entry first, so nothing is appended to stale text.
    await fields.get(`capture-${capture.id}`)?.flush()
    await fields.get(`entry-notes-${target}`)?.flush()
    const { res, j } = await post({ action: "capture_to_entry", capture_id: capture.id, entry_id: target, mode })
    setBusy(false)
    if (!res.ok || !j.ok) { onError(j.error || "Couldn't add the note to the entry."); return }
    onError(null)
    onEntryChanged(j.data.entry as Entry)
    onChanged(j.data.capture as Capture)
    setTarget("")
  }

  return (
    <div className="rw-capture">
      <AutoField id={`capture-${capture.id}`} registry={registry} multiline minRows={2}
        value={capture.body} version={capture.body_version} revision={capture.rev}
        ariaLabel="Quick Capture note" style={{ fontSize: 15 }}
        save={async (value, base) => {
          const { res, j } = await post({ action: "save_capture", capture_id: capture.id, value, base_version: base })
          if (res.ok && j.ok) return { ok: true, value: j.data.body, version: j.data.body_version }
          return { ok: false, status: res.status, error: j.error, current: j.current ? { value: j.current.body, version: j.current.body_version } : null }
        }} />
      {capture.copied_to_entry_id && (
        <div style={{ fontSize: 12, color: T.MUTED, marginTop: 4 }}>Copied into {entryLabel(capture.copied_to_entry_id)}</div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Entry to add this note to"
          style={{ flex: "1 1 160px", minWidth: 0, fontFamily: "inherit", fontSize: 13, padding: "5px 6px", borderRadius: 8, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT }}>
          <option value="">Add to an entry...</option>
          {TABS.map((t) => {
            const list = entries.filter((e) => e.tab === t)
            return list.length ? (
              <optgroup key={t} label={TAB_LABEL[t]}>
                {list.map((e) => <option key={e.id} value={e.id}>{e.title || "untitled entry"}</option>)}
              </optgroup>
            ) : null
          })}
        </select>
        <button type="button" className="rw-link" disabled={!target || busy} onClick={() => void send("copy")}>Copy</button>
        <button type="button" className="rw-link" disabled={!target || busy} onClick={() => void send("move")}>Move</button>
        {confirming ? (
          <>
            <button type="button" className="rw-link rw-danger" onClick={async () => {
              const { res, j } = await post({ action: "delete_capture", capture_id: capture.id })
              if (!res.ok || !j.ok) { onError(j.error || "Couldn't delete the note."); return }
              onDeleted(capture.id)
            }}>Delete note</button>
            <button type="button" className="rw-link" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <button type="button" className="rw-link" onClick={() => setConfirming(true)} style={{ marginLeft: "auto" }}>Delete</button>
        )}
      </div>
    </div>
  )
}

function ResumePanel({ resume, hasResumeEntries, post, onChanged, onError }: {
  resume: Resume
  hasResumeEntries: boolean
  post: Post
  onChanged: () => void
  onError: (m: string | null) => void
}) {
  const [paste, setPaste] = useState("")
  const [busy, setBusy] = useState(false)
  if (!resume.text) {
    return (
      <div>
        <p style={{ fontSize: 14, color: T.TEXT, margin: "0 0 8px" }}>
          No resume is on file for this client. Paste the resume text here to keep it beside your notes. It is saved with this workshop only.
        </p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={10} aria-label="Paste resume text"
          style={{ width: "100%", boxSizing: "border-box", fontFamily: "inherit", fontSize: 14, padding: "8px 10px", borderRadius: 10, border: `1px solid ${T.BORDER}`, background: T.CARD, color: T.TEXT }} />
        <button type="button" disabled={!paste.trim() || busy} style={{ ...btnSecondary, marginTop: 6 }}
          onClick={async () => {
            setBusy(true)
            const { res, j } = await post({ action: "paste_resume", value: paste })
            setBusy(false)
            if (!res.ok || !j.ok) { onError(j.error || "Couldn't save the resume text."); return }
            onChanged()
          }}>
          {busy ? "Saving..." : "Save resume text"}
        </button>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: T.MUTED, marginBottom: 6 }}>
        {resume.label}. Text only: the original file is not stored in SIGNAL. Read-only here.
      </div>
      {resume.source === "pasted" && !hasResumeEntries && (
        <button type="button" disabled={busy} className="rw-link" style={{ marginBottom: 8 }}
          onClick={async () => {
            setBusy(true)
            const { res, j } = await post({ action: "prefill_pasted" })
            setBusy(false)
            if (!res.ok || !j.ok) { onError(j.error || "Couldn't create entries."); return }
            onChanged()
          }}>
          Create entries from this resume
        </button>
      )}
      <div className="rw-resume">{resume.text}</div>
    </div>
  )
}

const CONSULT_LABELS: [string, string][] = [
  ["why_now", "Why now"], ["search_goal", "Search goal"], ["search_goal_other", "Search goal (other)"],
  ["services", "Services discussed"], ["timeline_deadlines", "Deadlines"], ["timeline_start", "Start"],
  ["timeline_season", "Season"], ["tried_so_far", "Tried so far"], ["material_resume", "Resume"],
  ["material_linkedin", "LinkedIn"], ["material_cover_letter", "Cover letter"],
  ["recommendation", "Recommendation"], ["next_steps", "Next steps"],
]

function show(key: string, v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (Array.isArray(v)) {
    if (!v.length) return null
    return v.map((x) => (key === "services" ? (SERVICE_LABEL as Record<string, string>)[String(x)] ?? String(x) : String(x))).join(", ")
  }
  if (key === "search_goal") return (SEARCH_GOAL_LABEL as Record<string, string>)[String(v)] ?? String(v)
  if (key.startsWith("material_")) return (MATERIAL_STATE_LABEL as Record<string, string>)[String(v)] ?? String(v)
  return typeof v === "object" ? JSON.stringify(v) : String(v)
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: T.MUTED, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 14, whiteSpace: "pre-wrap", color: T.TEXT }}>{value}</div>
    </div>
  )
}
function Heading({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, fontWeight: 900, margin: "12px 0 6px", color: T.TEXT }}>{children}</div>
}

function ConsultPanel({ consult }: { consult: Consult }) {
  const rows = consult.consult ? CONSULT_LABELS.map(([k, label]) => [label, show(k, consult.consult![k])] as const).filter(([, v]) => v) : []
  const targets = ([["Target roles", consult.targets.roles], ["Target industries", consult.targets.industries], ["Target locations", consult.targets.locations]] as const)
    .map(([l, v]) => [l, show("", v)] as const).filter(([, v]) => v)
  const form = consult.booking_form ? Object.entries(consult.booking_form).map(([k, v]) => [k.replace(/_/g, " "), show(k, v)] as const).filter(([, v]) => v) : []
  if (!rows.length && !targets.length && !consult.engagements.length && !form.length) {
    return <p style={{ fontSize: 14, color: T.MUTED }}>No consultation notes or engagement goals are on file for this client.</p>
  }
  return (
    <div style={{ fontSize: 14 }}>
      <p style={{ fontSize: 12, color: T.MUTED, margin: "0 0 6px" }}>Read-only, from the consultation and the client&apos;s engagements.</p>
      {rows.length > 0 && <><Heading>Consultation</Heading>{rows.map(([l, v]) => <Row key={l} label={l} value={v!} />)}</>}
      {targets.length > 0 && <><Heading>Goals on file</Heading>{targets.map(([l, v]) => <Row key={l} label={l} value={v!} />)}</>}
      {consult.engagements.length > 0 && (
        <>
          <Heading>Engagements</Heading>
          {consult.engagements.map((e) => (
            <Row key={e.name} label={`${e.name} (${e.status})`} value={e.deliverables.join(", ") || "No deliverables"} />
          ))}
        </>
      )}
      {form.length > 0 && <><Heading>Booking form</Heading>{form.map(([l, v]) => <Row key={l} label={l} value={v!} />)}</>}
    </div>
  )
}

const CSS = `
.rw-tabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 10px; margin-bottom: 14px; border-bottom: 1px solid ${T.BORDER_SOFT}; scrollbar-width: thin; }
.rw-tab { flex-shrink: 0; white-space: nowrap; font-family: inherit; font-size: 14px; font-weight: 800; padding: 8px 14px; border-radius: 10px;
  border: 1px solid ${T.BORDER_SOFT}; background: ${T.GLASS}; color: ${T.MUTED}; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.rw-tab:hover { color: ${T.TEXT}; }
.rw-tab-on { border-color: ${T.ORANGE_BORDER}; background: rgba(254,176,106,0.10); color: ${T.TEXT}; box-shadow: inset 0 -3px 0 #FF6B00; }
.rw-tab-general { margin-left: 8px; }
.rw-tab-sm { font-size: 13px; padding: 6px 10px; }
.rw-count { font-size: 12px; font-weight: 900; background: ${T.BORDER_SOFT}; color: ${T.TEXT}; border-radius: 999px; padding: 1px 7px; }
.rw-grid { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 22px; align-items: start; }
.rw-grid-closed { grid-template-columns: minmax(0, 1fr) 140px; }
.rw-side { position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow-y: auto; padding: 14px; border-radius: 14px;
  border: 1px solid ${T.BORDER_SOFT}; background: ${T.CARD}; }
.rw-entry { padding: 14px; border-radius: 14px; border: 1px solid ${T.BORDER_SOFT}; background: ${T.CARD}; margin-bottom: 14px; }
.rw-guide { margin-bottom: 14px; border: 1px solid ${T.BORDER_SOFT}; border-radius: 12px; padding: 8px 12px; background: ${T.GLASS}; }
.rw-guide summary, .rw-excerpt summary { cursor: pointer; font-weight: 800; font-size: 14px; color: ${T.TEXT}; }
.rw-excerpt { margin-top: 10px; padding: 8px 12px; border-radius: 10px; background: ${T.GLASS}; border-left: 3px solid #009BFF; }
.rw-excerpt summary { font-size: 13px; color: ${T.MUTED}; }
.rw-capture { padding: 10px; border-radius: 10px; border: 1px solid ${T.BORDER_SOFT}; }
.rw-resume { white-space: pre-wrap; font-size: 14px; line-height: 1.5; color: ${T.TEXT}; }
.rw-link { background: none; border: none; padding: 0; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 800; color: ${T.MUTED}; text-decoration: underline; }
.rw-link:disabled { opacity: 0.45; cursor: default; }
.rw-danger { color: ${T.ERROR}; }
@media (max-width: 1100px) {
  .rw-grid, .rw-grid-closed { grid-template-columns: minmax(0, 1fr); }
  .rw-side { position: static; max-height: none; }
}
`
