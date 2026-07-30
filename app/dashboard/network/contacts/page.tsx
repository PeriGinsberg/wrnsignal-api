"use client"

// Network Tracker — CONTACTS as a spreadsheet view (DASHBOARD.md Part 2).
// Replaces the old roster outright: one dense table, scannable columns, not cards.
// Columns: Company · Name · Title · Relationship · Priority · Stage ·
//          Last touch · Due (+ inline actions)
// Exactly TWO inline actions per row: log the due touch, and change stage (the
// Stage column dropdown). Snooze is a deliberate decision — it lives on the
// contact record, not fired off mid-scan. Everything else (notes, backdating,
// field edits) is also on the record. Full list fetched once (default sort:
// no-activity first, then most-recent); filtering + the computed Due are
// client-side. Filter state can arrive via URL query params so the (future)
// dashboard can deep-link here pre-filtered.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { T, headline, select as selectStyle, selectOption } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"
import { AddContactForm } from "../AddContactForm"
import {
  STAGE_LABELS, RELATIONSHIP_LABELS, RELATIONSHIPS, PRIORITIES, FIELD_LABELS, VIEW_LABELS,
} from "../vocab"
import { dueOf, needsMe, heroSort, HERO_CAP, type Contact } from "./contactModel"
import { TodayHero } from "./TodayHero"
import { ContactGrid } from "./ContactGrid"
import { SelectionBar } from "./SelectionBar"
import { LIGHT as S } from "../../../../lib/theme/surfaces"
import { matchesQuery } from "./search"
import { STAGE_PHASE, PHASE_ORDER, PHASE_LABELS } from "../vocab"
import { isStalled, STALLED_DAYS } from "../dashboardMetrics"

const STANDALONE = "__standalone__"
const NO_RELATIONSHIP = "__none__"

// Read initial filter state from the URL (deep-link support). Client-only.
function urlParam(name: string): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get(name) ?? ""
}

// useSearchParams() requires a Suspense boundary — without one Next fails the
// build for any statically-prerendered route that reads it.
export default function ContactsSpreadsheetPage() {
  return (
    <Suspense fallback={null}>
      <ContactsSpreadsheetInner />
    </Suspense>
  )
}

function ContactsSpreadsheetInner() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Select MODE rather than a checkbox parked on every card: always-visible
  // checkboxes are the spreadsheet clutter this rebuild exists to remove. The
  // capability is unchanged, it is just asked for.
  const [selectMode, setSelectMode] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)

  // Post-delete confirmation from the contact record (?deleted=Name). Read once,
  // then strip the param so a refresh doesn't re-show it.
  useEffect(() => {
    const d = urlParam("deleted")
    if (d) {
      setBanner(`Deleted ${d}.`)
      const u = new URL(window.location.href)
      u.searchParams.delete("deleted")
      window.history.replaceState({}, "", u.toString())
    }
  }, [])

  // THE URL IS THE FILTER STATE. Previously these were seven useState values
  // seeded from window.location.search at mount and never re-read, so a filter
  // only ever applied on a full page load. Arriving from the dashboard is a
  // CLIENT navigation — the query string changes without the component being
  // remounted — so the deep-links pointed at the right URL and then did nothing.
  // Refreshing "fixed" it because a refresh is a mount.
  //
  // Deriving from useSearchParams() makes them reactive by construction: there
  // is no second copy that can go stale. It also fixes browser back/forward for
  // free, and makes a filtered view a shareable link.
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const fStage = sp.get("stage") ?? ""
  const fPhase = sp.get("phase") ?? ""
  const fRelationship = sp.get("relationship") ?? ""
  const fSegment = sp.get("segment") ?? ""
  const fPriority = sp.get("priority") ?? ""
  const fStatus = sp.get("status") ?? ""   // overdue | due_today | not_started | stalled
  // Free text, same URL-as-source-of-truth model as the dropdowns: a searched
  // view is shareable, survives back/forward, and needs no second copy of state.
  const fQuery = sp.get("q") ?? ""
  // Company is two params behind one control: an explicit id, or the standalone flag.
  const fCompany = sp.get("standalone") ? STANDALONE : (sp.get("company_id") ?? "")

  // Writing back to the URL is what keeps the dropdowns working now that they no
  // longer own the state. `replace`, not `push`, so tweaking a filter does not
  // stack history entries the back button has to chew through.
  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  const setFStage = useCallback((v: string) => setParam("stage", v), [setParam])
  const setFPhase = useCallback((v: string) => setParam("phase", v), [setParam])
  const setFRelationship = useCallback((v: string) => setParam("relationship", v), [setParam])
  const setFSegment = useCallback((v: string) => setParam("segment", v), [setParam])
  const setFPriority = useCallback((v: string) => setParam("priority", v), [setParam])
  const setFStatus = useCallback((v: string) => setParam("status", v), [setParam])
  const setFQuery = useCallback((v: string) => setParam("q", v), [setParam])
  const setFCompany = useCallback((v: string) => {
    const next = new URLSearchParams(sp.toString())
    next.delete("standalone"); next.delete("company_id")
    if (v === STANDALONE) next.set("standalone", "1")
    else if (v) next.set("company_id", v)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  // Frozen render order. The server sorts (no-activity first, then most-recent —
  // route.ts `.order("last_action_at"…)`), and a stage change or logged touch
  // rewrites last_action_at, so a naive refetch makes the edited row jump to a
  // new position mid-interaction — sometimes off-screen. We snapshot the id
  // order on first load and keep rendering in it, so the row you just edited
  // stays under your cursor. The ranking is a triage heuristic, not a live
  // invariant; it re-applies on an explicit Re-sort or a page reload.
  //
  // Rows the snapshot has never seen (newly added) sort to the end rather than
  // being dropped.
  const [orderIds, setOrderIds] = useState<string[] | null>(null)

  // THE FROZEN PARTITION, the same invariant one level up. Which world a contact
  // is in is snapshotted on load and held for the session: log the due touch on
  // a hero card and it STAYS in the hero, marked done, rather than teleporting
  // into the grid the moment its next_due_at changes. Re-derives on an explicit
  // Re-sort or a reload, never live.
  //
  // The urgency ranking is frozen WITH it. If the hero re-ranked live, the cap
  // would itself start moving cards around mid-work, which is the exact failure
  // the frozen order exists to prevent.
  const [heroIds, setHeroIds] = useState<string[] | null>(null)

  const load = useCallback(async (opts?: { resort?: boolean }) => {
    setError(null)
    try {
      const res = await authFetch("/api/network/contacts")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load contacts (${res.status})`)
      const rows: Contact[] = j.contacts ?? []
      setContacts(rows)
      setOrderIds((prev) => (prev === null || opts?.resort ? rows.map((c) => c.id) : prev))
      setHeroIds((prev) => (prev === null || opts?.resort
        ? heroSort(rows.filter((c) => needsMe(dueOf(c.next_due_at)))).map((c) => c.id)
        : prev))
    } catch (e: any) {
      setError(e?.message || String(e))
      setContacts([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // Escape leaves select mode, the same way it closes every other transient
  // mode on this function.
  useEffect(() => {
    if (!selectMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelectMode(false); setSelected(new Set()) }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [selectMode])

  // Brief highlight on the row just acted on. With the position frozen the row
  // no longer moves, so it needs its own confirmation that the write landed —
  // previously the jump WAS the (bad) feedback.
  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 1400)
    return () => clearTimeout(t)
  }, [flashId])

  const handleActed = useCallback((id: string) => {
    setFlashId(id)
    void load()
  }, [load])

  // Filter dropdown options derived from the data (segments + companies present).
  const segments = useMemo(
    () => Array.from(new Set(contacts.map((c) => c.segment).filter(Boolean) as string[])).sort(),
    [contacts],
  )
  const companies = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contacts) if (c.company_id && c.network_companies?.name) m.set(c.company_id, c.network_companies.name)
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [contacts])

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      // Search composes with the dropdowns rather than overriding them: it is
      // one more predicate in the same chain, so "litig" inside an active
      // stage filter narrows that stage, it does not search past it.
      if (!matchesQuery(c, fQuery)) return false
      if (fStage && c.stage !== fStage) return false
      if (fPhase && (STAGE_PHASE[c.stage] ?? "idle") !== fPhase) return false
      // NO_RELATIONSHIP is a real filter value, not "unset" — an empty filter
      // means "all", so "none" needs its own sentinel to be expressible at all.
      if (fRelationship === NO_RELATIONSHIP) { if (c.relationship) return false }
      else if (fRelationship && c.relationship !== fRelationship) return false
      if (fSegment && c.segment !== fSegment) return false
      if (fPriority && c.priority !== fPriority) return false
      if (fCompany === STANDALONE && c.company_id) return false
      if (fCompany && fCompany !== STANDALONE && c.company_id !== fCompany) return false
      if (fStatus) {
        const kind = dueOf(c.next_due_at).kind
        // `due` is the combined value the hero overflow chip uses. The four
        // original values are untouched.
        if (fStatus === "due" && kind !== "overdue" && kind !== "due_today") return false
        if (fStatus === "overdue" && kind !== "overdue") return false
        if (fStatus === "due_today" && kind !== "due_today") return false
        if (fStatus === "not_started" && c.stage !== "identified") return false
        // Same definition the dashboard's "stalled" row counts with — imported,
        // not restated, so the row and the link can never disagree.
        if (fStatus === "stalled" && !isStalled(c, new Date())) return false
      }
      return true
    })
  }, [contacts, fQuery, fStage, fPhase, fRelationship, fSegment, fPriority, fCompany, fStatus])

  // Apply the frozen order to whatever survived filtering. Selection logic below
  // deliberately keeps using `filtered` — it is set-based and order-independent.
  const ordered = useMemo(() => {
    if (!orderIds) return filtered
    const rank = new Map(orderIds.map((id, i) => [id, i]))
    return [...filtered].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }, [filtered, orderIds])

  // True once the live server ranking would differ from what's on screen, i.e.
  // some row has been acted on since the snapshot. Drives the Re-sort button so
  // it only appears when it would actually do something.
  const orderStale = useMemo(() => {
    if (!orderIds) return false
    const rank = new Map(orderIds.map((id, i) => [id, i]))
    return contacts.some((c, i) => rank.get(c.id) !== i)
  }, [contacts, orderIds])

  // THE TWO WORLDS. Both are drawn from `filtered`, so every filter and the
  // search compose with the split rather than fighting it.
  const { heroShown, heroOverflow, gridContacts } = useMemo(() => {
    const rank = new Map((heroIds ?? []).map((id, i) => [id, i]))
    const inHero = filtered.filter((c) => rank.has(c.id))
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    const shown = inHero.slice(0, HERO_CAP)
    const shownIds = new Set(shown.map((c) => c.id))
    // Overflow deliberately falls into the grid rather than growing the hero,
    // which is what the "+ N more due" chip goes to.
    return {
      heroShown: shown,
      heroOverflow: inHero.length - shown.length,
      gridContacts: ordered.filter((c) => !shownIds.has(c.id)),
    }
  }, [filtered, ordered, heroIds])

  const anyFilter = fQuery || fStage || fPhase || fRelationship || fSegment || fPriority || fCompany || fStatus
  function clearFilters() {
    // One replace, not seven — seven sequential calls would each read a stale
    // `sp` and the last would win, clearing only one filter.
    const next = new URLSearchParams(sp.toString())
    for (const k of ["q", "stage", "phase", "relationship", "segment", "priority", "status", "company_id", "standalone"]) next.delete(k)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  // Selection is scoped to the VISIBLE (filtered) rows — "select all" means the
  // current filtered set, and you can only ever delete what you can see. Rows
  // that leave the filter drop out of the effective selection automatically.
  const effectiveSelected = useMemo(() => filtered.filter((c) => selected.has(c.id)), [filtered, selected])
  const allVisibleSelected = filtered.length > 0 && effectiveSelected.length === filtered.length

  function toggleOne(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function toggleAllVisible() {
    setSelected((s) => {
      const n = new Set(s)
      if (allVisibleSelected) filtered.forEach((c) => n.delete(c.id))
      else filtered.forEach((c) => n.add(c.id))
      return n
    })
  }

  async function runBulkDelete() {
    const ids = effectiveSelected.map((c) => c.id)
    if (ids.length === 0) return
    setDeleting(true); setError(null)
    try {
      const res = await authFetch("/api/network/contacts/delete", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Delete failed (${res.status})`)
      setBanner(`Deleted ${j.deleted} contact${j.deleted === 1 ? "" : "s"}.`)
      setSelected(new Set())
      setConfirmDelete(false)
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main style={{ padding: "24px", margin: "0 auto", maxWidth: 1280 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={headline}>{VIEW_LABELS.contacts.heading}</h1>
          <p style={{ color: T.MUTED, fontSize: 13, marginTop: 6 }}>
            {loading ? "Loading…" : `${filtered.length}${filtered.length !== contacts.length ? ` of ${contacts.length}` : ""} contact${contacts.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
          <a href="/dashboard/network/import" style={{ ...addBtn, textDecoration: "none", display: "inline-block" }}>Import</a>
          <button onClick={() => setAddOpen(true)} style={addBtn}>+ Add a contact</button>
        </div>
      </div>

      {addOpen && <AddContactForm onClose={() => setAddOpen(false)} onCreated={load} />}

      {/* post-delete / bulk-delete confirmation banner */}
      {banner && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`, display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: T.TEXT, fontSize: 13, fontWeight: 700, flex: 1 }}>{banner}</span>
          <button onClick={() => setBanner(null)} style={{ background: "none", border: "none", color: T.DIM, fontSize: 16, cursor: "pointer" }}>×</button>
        </div>
      )}

      {/* bulk-delete action bar — appears when any visible rows are selected */}
      {effectiveSelected.length > 0 && (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: T.GLASS, border: `1px solid ${T.BORDER}`, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: T.TEXT, fontSize: 13, fontWeight: 700, flex: 1 }}>{effectiveSelected.length} selected</span>
          <button onClick={() => setSelected(new Set())} style={ghostBtn}>Clear selection</button>
          <button onClick={() => setConfirmDelete(true)}
            style={{ background: "none", border: `1px solid rgba(255,120,120,0.4)`, color: T.ERROR, borderRadius: 10, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            Delete {effectiveSelected.length}
          </button>
        </div>
      )}

      {confirmDelete && (
        <BulkDeleteConfirm
          contacts={effectiveSelected}
          busy={deleting}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={runBulkDelete}
        />
      )}

      {/* Filter bar, hidden until there is something to filter. On a brand-new
          account six dropdowns and ~40 options sat above the words "No contacts
          yet", so the first thing a new user met was machinery rather than the
          invitation.

          Guarded on contacts.length, NOT filtered.length — keying it on the
          filtered set would make the bar vanish the moment a filter matched
          nothing, taking the controls needed to clear that filter with it. */}
      {contacts.length > 0 && (
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="search"
          value={fQuery}
          onChange={(e) => setFQuery(e.target.value)}
          placeholder="Search name, company, title, email"
          aria-label="Search contacts"
          data-testid="contacts-search"
          style={{
            ...selectStyle, width: 260, height: 34, fontSize: 12,
            // selectStyle carries a dropdown arrow background; a text input must not.
            background: T.GLASS, backgroundImage: "none", appearance: "none",
          }}
        />
        <Filter value={fStage} onChange={setFStage} allLabel="All stages">
          {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k} style={selectOption}>{v}</option>)}
        </Filter>
        <Filter value={fPhase} onChange={setFPhase} allLabel="All phases">
          {PHASE_ORDER.map((p) => <option key={p} value={p} style={selectOption}>{PHASE_LABELS[p]}</option>)}
        </Filter>
        <Filter value={fRelationship} onChange={setFRelationship} allLabel="All relationships">
          <option value={NO_RELATIONSHIP} style={selectOption}>No relationship set</option>
          {RELATIONSHIPS.map((r) => <option key={r} value={r} style={selectOption}>{RELATIONSHIP_LABELS[r]}</option>)}
        </Filter>
        <Filter value={fSegment} onChange={setFSegment} allLabel="All segments">
          {segments.map((s) => <option key={s} value={s} style={selectOption}>{s}</option>)}
        </Filter>
        <Filter value={fPriority} onChange={setFPriority} allLabel="All priorities">
          {PRIORITIES.map((p) => <option key={p} value={p} style={selectOption}>Priority {p}</option>)}
        </Filter>
        <Filter value={fCompany} onChange={setFCompany} allLabel="All companies">
          <option value={STANDALONE} style={selectOption}>Standalone only</option>
          {companies.map((c) => <option key={c.id} value={c.id} style={selectOption}>{c.name}</option>)}
        </Filter>
        <Filter value={fStatus} onChange={setFStatus} allLabel="Any status">
          <option value="overdue" style={selectOption}>Overdue</option>
          <option value="due_today" style={selectOption}>Due today</option>
          <option value="not_started" style={selectOption}>Not started</option>
          <option value="stalled" style={selectOption}>Stalled {STALLED_DAYS}+ days</option>
        </Filter>
        {anyFilter && <button onClick={clearFilters} style={ghostBtn}>Clear</button>}
        {/* Re-sort gives the ranking back on demand. Only shown once the frozen
            order actually differs from the server's, so it never sits there as
            dead chrome. */}
        {orderStale && (
          <button onClick={() => void load({ resort: true })} style={ghostBtn} title="Re-rank by most recent activity">
            Re-sort
          </button>
        )}
      </div>
      )}

      {error && <div style={{ color: T.ERROR, fontSize: 13, marginTop: 16 }}>{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div style={{ marginTop: 18, padding: "32px 24px", textAlign: "center", border: `1px dashed ${T.BORDER_SOFT}`, borderRadius: 14, color: T.MUTED, fontSize: 13 }}>
          {anyFilter ? "No contacts match these filters." : "No contacts yet. Add your first one."}
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {selectMode && (
            <SelectionBar
              count={effectiveSelected.length}
              allSelected={allVisibleSelected}
              onSelectAll={toggleAllVisible}
              onClear={() => setSelected(new Set())}
              onDelete={() => setConfirmDelete(true)}
            />
          )}

          <TodayHero
            shown={heroShown}
            overflow={heroOverflow}
            onChanged={handleActed}
            selectMode={selectMode}
            selectedIds={selected}
            onToggle={toggleOne}
            flashId={flashId}
            onSeeOverflow={() => {
              setFStatus("due")
              document.getElementById("everyone")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }}
          />

          <ContactGrid
            contacts={gridContacts}
            total={contacts.length}
            onChanged={handleActed}
            selectMode={selectMode}
            onToggleSelectMode={() => {
              setSelectMode((m) => {
                if (m) setSelected(new Set())   // leaving the mode drops the selection
                return !m
              })
            }}
            selectedIds={selected}
            onToggle={toggleOne}
            flashId={flashId}
            emptyNote={
              heroShown.length > 0
                ? "Everyone who needs you is in TODAY, above."
                : anyFilter
                  ? "No contacts match these filters."
                  : "No contacts yet. Add your first one."
            }
          />
        </>
      )}
    </main>
  )
}

function Filter({ value, onChange, allLabel, children }: {
  value: string; onChange: (v: string) => void; allLabel: string; children: React.ReactNode
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, width: "auto", height: 34, fontSize: 12 }}>
      <option value="" style={selectOption}>{allLabel}</option>
      {children}
    </select>
  )
}

// Confirm modal that names WHO is being deleted, not just the count.
function BulkDeleteConfirm({
  contacts, busy, onCancel, onConfirm,
}: {
  contacts: Contact[]
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const names = contacts.map((c) => `${c.first_name} ${c.last_name}`.trim())
  const n = names.length
  // Small selection: name them all. Large: name the first few + "and N others".
  const shown = names.slice(0, 3)
  const body =
    n <= 4
      ? `Delete ${names.join(", ")}?`
      : `Delete ${n} contacts? Including ${shown.join(", ")} and ${n - shown.length} others.`

  return (
    <div style={overlay} onClick={busy ? undefined : onCancel}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div style={{ color: T.TEXT, fontSize: 15, fontWeight: 800, lineHeight: "22px" }}>{body}</div>
        <div style={{ color: T.MUTED, fontSize: 13, marginTop: 8, lineHeight: "20px" }}>
          This removes their action logs and notes. This can&apos;t be undone.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button onClick={onConfirm} disabled={busy}
            style={{ background: T.ERROR, color: T.INK_ON_ERROR, border: "none", borderRadius: 11, padding: "10px 18px", fontSize: 13, fontWeight: 900, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Deleting…" : `Delete ${n}`}
          </button>
          <button onClick={onCancel} disabled={busy}
            style={{ background: T.GLASS, color: T.TEXT, border: `1px solid ${T.BORDER}`, borderRadius: 11, padding: "10px 18px", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(4,6,15,0.6)", display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "16vh 16px", zIndex: 50,
}
const panel: React.CSSProperties = {
  background: T.CARD, border: `1px solid ${T.BORDER}`, borderRadius: 18, padding: 24, width: "100%", maxWidth: 460,
}
const addBtn: React.CSSProperties = {
  background: T.GLASS, color: T.TEXT, border: `1px solid ${T.BORDER}`, borderRadius: 11,
  padding: "9px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", flex: "0 0 auto",
}
const ghostBtn: React.CSSProperties = { background: "none", border: "none", color: T.DIM, fontSize: 12, fontWeight: 700, cursor: "pointer" }
