"use client"

// Network Tracker: CONTACTS, the full roster.
//
// Redesign step 3 (2026-08-03). Was a dense spreadsheet; it is now a list of
// designed cards in the light theme. The information architecture is unchanged
// (same data, same URL-as-filter-state model, same search); what changed is that
// a contact is presented as an object with one obvious action rather than as a
// row of nine columns.
//
// FILTERS. The visible set is deliberately two, search plus stage plus company,
// because a student with no coach should meet an invitation and not machinery.
// The other five (phase, relationship, segment, priority, status) are STILL
// LIVE as URL params, because the dashboard deep-links into them and those links
// must keep working. When one is active it announces itself as a chip with a way
// to clear it, so a filtered view can never look like an empty roster. Capability
// preserved, quiet.
//
// SELECTION. Bulk delete is real capability and is not dropped, but checkboxes on
// every card would make a calm list look like a spreadsheet again. It lives
// behind a quiet "Select" toggle.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { LIGHT as S, action as actionStyle } from "../../../lib/theme/surfaces"
import { authFetch } from "./authFetch"
import { AddContactForm } from "./AddContactForm"
import { safeReturn, safeReturnLabel } from "../../../lib/network-tracker/safeReturn"
import { STAGE_LABELS, VIEW_LABELS } from "./vocab"
import { dueOf, type Contact } from "./contacts/ContactRow"
import { ContactCard } from "./contacts/ContactCard"
import { sortForAttention, attentionRank, BAND_LABELS, type AttentionRank } from "./contacts/contactOrder"
import { matchesQuery } from "./contacts/search"
import { inActivityWindow, ACTIVITY_LABELS, type ActivityWindow } from "./contacts/activityWindow"
import { EmptyCompanyStrip, type EmptyCompany } from "./EmptyCompanyStrip"
import { CompanyPanel } from "./CompanyPanel"
import { SearchIcon, ImportIcon } from "../../../components/icons"
import { subjectId } from "./authFetch"
import { STAGE_PHASE, PHASE_LABELS, RELATIONSHIP_LABELS } from "./vocab"
import { isStalled, STALLED_DAYS } from "./dashboardMetrics"
import type { PhaseKey } from "../../../lib/dashboard-theme"

const STANDALONE = "__standalone__"
const NO_RELATIONSHIP = "__none__"

function urlParam(name: string): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get(name) ?? ""
}

// useSearchParams() requires a Suspense boundary. Without one Next fails the
// build for any statically-prerendered route that reads it.
export function NetworkLanding() {
  return (
    <Suspense fallback={null}>
      <ContactsInner />
    </Suspense>
  )
}

function ContactsInner() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  // The FULL company list, which the roster alone cannot give: a company
  // with no contacts appears in no contact row, and those are exactly the
  // ones the strip is about.
  // NULL until the fetch returns. See EmptyCompanyStrip: [] means "none are
  // empty", and conflating that with "not loaded" wiped the dismissals.
  const [allCompanies, setAllCompanies] = useState<{ id: string; name: string; contact_count: number }[] | null>(null)
  const [panelCompanyId, setPanelCompanyId] = useState<string | null>(null)
  // Bumped after a contact is added from inside the panel, so the panel's card
  // reloads instead of sitting one person out of date under the modal.
  const [panelReload, setPanelReload] = useState(0)
  // The company Add a contact should open with, set by whichever surface asked
  // for it: the empty-company strip, or the company panel. Falls back to the
  // ?company= param the add-from-a-company flow already used.
  const [companyPrefill, setCompanyPrefill] = useState("")
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
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

  // THE URL IS THE FILTER STATE. Deriving from useSearchParams() makes these
  // reactive by construction: there is no second copy that can go stale. It also
  // fixes browser back/forward for free, and makes a filtered view shareable.
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // ARRIVING FROM OUTSIDE NETWORKING, with the company already known.
  // `?add=1&company=Globex&return=…&label=…` opens the form prefilled, so the
  // application detail does not know a company and then forget it one screen
  // later. Query params rather than sessionStorage because this page already
  // treats the URL as its state (see the comment above), and because the
  // intent here is explicit rather than a remembered origin, which is what
  // backTarget is for.
  const addParam = sp.get("add")
  const prefillCompany = sp.get("company") ?? ""
  // Both validated: `return` is an open-redirect surface and `label` is
  // attacker-supplied text rendered as a control. See lib/network-tracker/safeReturn.ts.
  const returnTo = safeReturn(sp.get("return"))
  const returnLabel = safeReturnLabel(sp.get("label"))

  useEffect(() => {
    if (addParam) setAddOpen(true)
  }, [addParam])

  const fStage = sp.get("stage") ?? ""
  const fPhase = sp.get("phase") ?? ""
  const fRelationship = sp.get("relationship") ?? ""
  const fSegment = sp.get("segment") ?? ""
  const fPriority = sp.get("priority") ?? ""
  const fStatus = sp.get("status") ?? ""   // overdue | due_today | not_started | stalled
  const fQuery = sp.get("q") ?? ""
  // WHEN, the axis the list could not express. See ./activityWindow.
  const fActivity = (sp.get("activity") ?? "") as ActivityWindow
  // Company is two params behind one control: an explicit id, or the standalone flag.
  const fCompany = sp.get("standalone") ? STANDALONE : (sp.get("company_id") ?? "")

  // `replace`, not `push`, so tweaking a filter does not stack history entries
  // the back button has to chew through.
  const setParam = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(sp.toString())
    if (value) next.set(key, value)
    else next.delete(key)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  const setFStage = useCallback((v: string) => setParam("stage", v), [setParam])
  const setFActivity = useCallback((v: string) => setParam("activity", v), [setParam])
  const setFQuery = useCallback((v: string) => setParam("q", v), [setParam])
  const setFCompany = useCallback((v: string) => {
    const next = new URLSearchParams(sp.toString())
    next.delete("standalone"); next.delete("company_id")
    if (v === STANDALONE) next.set("standalone", "1")
    else if (v) next.set("company_id", v)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  const clearParams = useCallback((keys: string[]) => {
    const next = new URLSearchParams(sp.toString())
    for (const k of keys) next.delete(k)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [sp, router, pathname])

  // Frozen render order, now ranked by ATTENTION rather than by the server's
  // no-activity-first ordering. See contactOrder.ts for why: the server order
  // stacks every receded card above every live one, which is the opposite of
  // what the card language is for.
  //
  // Still frozen at load so a refetch cannot reshuffle the list under a pointer.
  // Cards the snapshot has never seen (newly added) sort to the end rather than
  // being dropped.
  const [orderIds, setOrderIds] = useState<string[] | null>(null)
  /**
   * The rank each contact had WHEN THE ORDER WAS FROZEN, not its rank now.
   *
   * The band headings have to agree with the sequence they label. Recomputing a
   * rank at render time against a frozen order is how you get "Overdue" twice
   * with "Due today" in between: the row has moved band but not position. Freeze
   * both together and the two can never disagree until the next resort.
   */
  const [frozenRanks, setFrozenRanks] = useState<Map<string, AttentionRank> | null>(null)

  const loadCompanies = useCallback(async () => {
    try {
      const res = await authFetch("/api/network/companies")
      const j = await res.json()
      if (res.ok && j?.ok !== false) setAllCompanies(j.companies ?? [])
    } catch {
      // The strip is an extra. A failure here must not take the roster with it.
    }
  }, [])

  useEffect(() => { void loadCompanies() }, [loadCompanies])

  const emptyCompanies: EmptyCompany[] | null = useMemo(
    () => allCompanies === null
      ? null
      : allCompanies.filter((c) => (c.contact_count ?? 0) === 0).map((c) => ({ id: c.id, name: c.name })),
    [allCompanies],
  )

  const load = useCallback(async (opts?: { resort?: boolean }) => {
    setError(null)
    try {
      const res = await authFetch("/api/network/contacts")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load contacts (${res.status})`)
      const rows: Contact[] = j.contacts ?? []
      setContacts(rows)
      setOrderIds((prev) => {
        if (prev !== null && !opts?.resort) return prev
        const now = new Date()
        setFrozenRanks(new Map(rows.map((c) => [c.id, attentionRank(c, now)])))
        return sortForAttention(rows, now).map((c) => c.id)
      })
    } catch (e: any) {
      setError(e?.message || String(e))
      setContacts([])
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const [flashId, setFlashId] = useState<string | null>(null)
  useEffect(() => {
    if (!flashId) return
    const t = setTimeout(() => setFlashId(null), 1400)
    return () => clearTimeout(t)
  }, [flashId])

  const companies = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contacts) if (c.company_id && c.network_companies?.name) m.set(c.company_id, c.network_companies.name)
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [contacts])

  const filtered = useMemo(() => {
    return contacts.filter((c) => {
      // Search composes with the dropdowns rather than overriding them: it is
      // one more predicate in the same chain, so "litig" inside an active stage
      // filter narrows that stage, it does not search past it.
      if (!matchesQuery(c, fQuery)) return false
      if (fStage && c.stage !== fStage) return false
      if (!inActivityWindow(c.last_action_at, fActivity, new Date())) return false
      if (fPhase && (STAGE_PHASE[c.stage] ?? "idle") !== fPhase) return false
      // NO_RELATIONSHIP is a real filter value, not "unset": an empty filter
      // means "all", so "none" needs its own sentinel to be expressible at all.
      if (fRelationship === NO_RELATIONSHIP) { if (c.relationship) return false }
      else if (fRelationship && c.relationship !== fRelationship) return false
      if (fSegment && c.segment !== fSegment) return false
      if (fPriority && c.priority !== fPriority) return false
      if (fCompany === STANDALONE && c.company_id) return false
      if (fCompany && fCompany !== STANDALONE && c.company_id !== fCompany) return false
      if (fStatus) {
        const kind = dueOf(c.next_due_at).kind
        if (fStatus === "overdue" && kind !== "overdue") return false
        if (fStatus === "due_today" && kind !== "due_today") return false
        if (fStatus === "not_started" && c.stage !== "identified") return false
        // Same definition the dashboard's "stalled" row counts with, imported,
        // not restated, so the row and the link can never disagree.
        if (fStatus === "stalled" && !isStalled(c, new Date())) return false
      }
      return true
    })
  }, [contacts, fQuery, fStage, fActivity, fPhase, fRelationship, fSegment, fPriority, fCompany, fStatus])

  const ordered = useMemo(() => {
    if (!orderIds) return filtered
    const rank = new Map(orderIds.map((id, i) => [id, i]))
    return [...filtered].sort(
      (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }, [filtered, orderIds])

  /**
   * The ordered list with a heading inserted wherever the band changes.
   *
   * ONE FLAT ARRAY, headings as siblings of the cards — NOT a section per band.
   * The companies board shipped that shape and it was a real bug: React keys are
   * only stable within a parent, so a card whose band changed was rendered under
   * a different parent, unmounted, and rebuilt, losing its state. Here it would
   * throw away selection and the flash highlight. Flat keeps every card a
   * sibling, so a band change is a move.
   *
   * Bands are read from the FROZEN ranks, so the labels match the sequence.
   * Filtering can empty a band; a heading is only emitted when a card follows it.
   */
  type Banded =
    | { kind: "heading"; rank: AttentionRank; count: number }
    | { kind: "card"; contact: Contact }

  const banded = useMemo(() => {
    const out: Banded[] = []
    if (!frozenRanks) return ordered.map((c) => ({ kind: "card", contact: c }) as Banded)
    let current: AttentionRank | null = null
    for (const c of ordered) {
      const r = frozenRanks.get(c.id)
      // A contact added since the freeze has no band. It already sorts to the
      // end; leave it under whatever heading it lands in rather than inventing
      // a band the sort did not use.
      if (r !== undefined && r !== current) {
        current = r
        out.push({ kind: "heading", rank: r, count: 0 })
      }
      out.push({ kind: "card", contact: c })
    }
    // Counts, now that the runs are known — the heading is more useful saying
    // how many are in it.
    for (let i = 0; i < out.length; i++) {
      const h = out[i]
      if (h.kind !== "heading") continue
      let n = 0
      for (let j = i + 1; j < out.length && out[j].kind === "card"; j++) n++
      h.count = n
    }
    return out
  }, [ordered, frozenRanks])

  // The five filters that have no control on this screen. Each is still live via
  // the URL, so a dashboard deep-link works; each announces itself here so a
  // narrowed list never reads as an empty roster.
  const hiddenFilters = useMemo(() => {
    const out: { key: string; label: string; params: string[] }[] = []
    if (fPhase) out.push({ key: "phase", label: `Group: ${PHASE_LABELS[fPhase as PhaseKey] ?? fPhase}`, params: ["phase"] })
    if (fRelationship) {
      out.push({
        key: "relationship",
        label: fRelationship === NO_RELATIONSHIP
          ? "No relationship set"
          : `Relationship: ${RELATIONSHIP_LABELS[fRelationship] ?? fRelationship}`,
        params: ["relationship"],
      })
    }
    if (fSegment) out.push({ key: "segment", label: `Segment: ${fSegment}`, params: ["segment"] })
    if (fPriority) out.push({ key: "priority", label: `Priority ${fPriority}`, params: ["priority"] })
    if (fStatus) {
      const words: Record<string, string> = {
        overdue: "Overdue",
        due_today: "Due today",
        not_started: "Not started",
        stalled: `Quiet for ${STALLED_DAYS}+ days`,
      }
      out.push({ key: "status", label: words[fStatus] ?? fStatus, params: ["status"] })
    }
    return out
  }, [fPhase, fRelationship, fSegment, fPriority, fStatus])

  const anyFilter = Boolean(
    fQuery || fStage || fActivity || fPhase || fRelationship || fSegment || fPriority || fCompany || fStatus,
  )
  function clearFilters() {
    // One replace, not eight: sequential calls would each read a stale `sp` and
    // the last would win, clearing only one filter.
    clearParams(["q", "stage", "phase", "relationship", "segment", "priority", "status", "company_id", "standalone"])
  }

  // Selection is scoped to the VISIBLE rows, so you can only ever delete what
  // you can see. Cards that leave the filter drop out of the selection.
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
  function exitSelectMode() {
    setSelectMode(false)
    setSelected(new Set())
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
      exitSelectMode()
      setConfirmDelete(false)
      await load()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  // WHAT A COACH DOES NOT GET, and why it is hidden rather than disabled.
  //
  // Import and bulk delete are the two controls whose routes are still
  // owner-only, and resolveOwnerScope IGNORES the subject parameter by design.
  // So for a coach these do not fail, which would be fine; they succeed against
  // the COACH'S OWN board. An import run from a client's screen would quietly
  // deposit that client's contacts in the coach's own roster, and the coach
  // would have no reason to look for them there.
  //
  // Hidden rather than greyed out because there is nothing the coach could do
  // to earn them. A disabled control is a promise that the right permission
  // would unlock it, and no permission level unlocks these.
  const viewingClientBoard = subjectId() !== null

  const companyCount = companies.length
  const countLine = loading
    ? "Loading…"
    : filtered.length !== contacts.length
      ? `${filtered.length} of ${contacts.length} people.`
      : `${contacts.length} ${contacts.length === 1 ? "person" : "people"}${companyCount ? ` across ${companyCount} ${companyCount === 1 ? "company" : "companies"}` : ""}.`

  return (
    <main style={{ maxWidth: 1080 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
        <div>
          <div style={eyebrowStyle}>Networking</div>
          <h1 style={h1Style}>{VIEW_LABELS.contacts.heading}</h1>
          <p style={{ color: S.text.muted, fontSize: 14.5, marginTop: 6 }}>{countLine}</p>
        </div>
        <div style={{ display: "flex", gap: 10, flex: "0 0 auto", alignItems: "center" }}>
          {!viewingClientBoard && (
            <a href="/dashboard/network/import" style={{ ...secondaryBtn, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 9 }}><ImportIcon size={19} />Import</a>
          )}
          <button onClick={() => setAddOpen(true)} style={{ ...actionStyle(S, "primary"), ...primarySize }}>
            + Add contact
          </button>
        </div>
      </div>

      {addOpen && (
        <AddContactForm
          initialCompany={companyPrefill || prefillCompany}
          returnTo={returnTo}
          returnLabel={returnLabel}
          onClose={() => { setAddOpen(false); setCompanyPrefill('') }}
          onCreated={() => {
            void load(); void loadCompanies()
            // Cheap and unconditional: if the panel is shut this changes a
            // number nothing reads, and if it is open behind the modal it is
            // the difference between the card showing the person you just
            // added and quietly not.
            setPanelReload((n) => n + 1)
          }}
        />
      )}

      {banner && (
        <div style={noticeStyle}>
          <span style={{ color: S.text.primary, fontSize: 14, fontWeight: 700, flex: 1 }}>{banner}</span>
          <button onClick={() => setBanner(null)} aria-label="Dismiss" style={dismissStyle}>×</button>
        </div>
      )}

      {contacts.length > 0 && (
        <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ position: "relative", flex: "1 1 320px", minWidth: 220, display: "flex", alignItems: "center" }}>
          <span style={{ position: "absolute", left: 14, display: "flex", pointerEvents: "none" }}>
            <SearchIcon size={19} />
          </span>
          <input
            type="search"
            value={fQuery}
            onChange={(e) => setFQuery(e.target.value)}
            placeholder="Search by name, company, title"
            aria-label="Search contacts"
            data-testid="contacts-search"
            style={searchStyle}
          />
          </span>
          <select
            value={fStage}
            onChange={(e) => setFStage(e.target.value)}
            aria-label="Filter by stage"
            style={selectStyle}
          >
            <option value="">All stages</option>
            {Object.entries(STAGE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select
            value={fCompany}
            onChange={(e) => setFCompany(e.target.value)}
            aria-label="Filter by company"
            style={selectStyle}
          >
            <option value="">All companies</option>
            <option value={STANDALONE}>No company</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select
            value={fActivity}
            onChange={(e) => setFActivity(e.target.value)}
            aria-label="Filter by last activity"
            data-testid="contacts-activity-filter"
            style={selectStyle}
          >
            <option value="">Any time</option>
            {Object.entries(ACTIVITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {/* Select exists only to feed bulk delete, so it goes with it. */}
          {!viewingClientBoard && (
            <button
              type="button"
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
              style={quietBtn}
            >
              {selectMode ? "Done selecting" : "Select"}
            </button>
          )}
          {anyFilter && (
            <button type="button" onClick={clearFilters} style={quietBtn}>Clear filters</button>
          )}
        </div>
      )}

      {/* Filters with no control on this screen still apply, and say so. */}
      {hiddenFilters.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
          {hiddenFilters.map((f) => (
            <span key={f.key} style={chipStyle}>
              {f.label}
              <button
                type="button"
                onClick={() => clearParams(f.params)}
                aria-label={`Clear ${f.label}`}
                style={chipClearStyle}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {selectMode && (
        <div style={selectBarStyle}>
          <button type="button" onClick={toggleAllVisible} style={quietBtn}>
            {allVisibleSelected ? "Clear all" : `Select all ${filtered.length}`}
          </button>
          <span style={{ flex: 1, color: S.text.muted, fontSize: 13.5 }}>
            {effectiveSelected.length} selected
          </span>
          {effectiveSelected.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              style={{
                background: S.card,
                border: `1px solid ${S.meaning.error.accent}`,
                color: S.meaning.error.ink,
                borderRadius: 10, padding: "8px 16px",
                fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              Delete {effectiveSelected.length}
            </button>
          )}
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

      {error && (
        <div style={{ color: S.meaning.error.ink, fontSize: 14, marginTop: 18 }}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div style={emptyStyle}>
          {anyFilter
            ? "No contacts match these filters."
            : "No contacts yet. Add your first one and start building your network."}
        </div>
      )}

      {/* Above the roster, below the controls: it is a prompt about the board,
          not a filter on the list, so it sits outside the toolbar. Renders
          nothing when every company has somebody at it. */}
      <EmptyCompanyStrip
        companies={emptyCompanies}
        onAddContact={(name) => { setCompanyPrefill(name); setAddOpen(true) }}
      />

      {filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
          {banded.map((item) =>
            item.kind === "heading" ? (
              <h2
                key={`band-${item.rank}`}
                data-testid={`band-${item.rank}`}
                style={{
                  margin: "10px 0 -2px", fontSize: 12, fontWeight: 800,
                  letterSpacing: 1.4, textTransform: "uppercase",
                  // Only the two that need doing now carry colour. Six coloured
                  // headings would be a legend, not a priority.
                  color: item.rank === 0 ? S.meaning.error.ink
                    : item.rank === 1 ? S.meaning.progress.ink
                    : S.text.muted,
                }}
              >
                {BAND_LABELS[item.rank]} · {item.count}
              </h2>
            ) : (
              <ContactCard
                key={item.contact.id}
                contact={item.contact}
                selectMode={selectMode}
                checked={selected.has(item.contact.id)}
                onToggle={() => toggleOne(item.contact.id)}
                flash={flashId === item.contact.id}
                onOpenCompany={(id) => setPanelCompanyId(id)}
              />
            ),
          )}
        </div>
      )}

      {/* The company, opened from a row rather than from its own tab. Last in
          the tree and fixed-positioned, so no card's stacking context can trap
          it: the same reason the Framer bundle keeps its modals outside the
          shell. */}
      <CompanyPanel
        companyId={panelCompanyId}
        reloadToken={panelReload}
        onClose={() => setPanelCompanyId(null)}
        onChanged={() => { void load(); void loadCompanies() }}
        // The panel stays OPEN behind the form. You came here from a company,
        // you are adding someone at that company, and you will want to see the
        // list you were reading once you have. The form sits above it (z-index
        // 70 against the panel's 60) rather than replacing it.
        onAddContact={(name) => { setCompanyPrefill(name); setAddOpen(true) }}
      />
    </main>
  )
}

// Names WHO is being deleted, not just the count.
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
  const shown = names.slice(0, 3)
  const body =
    n <= 4
      ? `Delete ${names.join(", ")}?`
      : `Delete ${n} contacts? Including ${shown.join(", ")} and ${n - shown.length} others.`

  return (
    <div style={overlayStyle} onClick={busy ? undefined : onCancel}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ color: S.text.primary, fontSize: 16, fontWeight: 800, lineHeight: "23px" }}>{body}</div>
        <div style={{ color: S.text.muted, fontSize: 14, marginTop: 10, lineHeight: "21px" }}>
          This removes their action logs and notes. This can&apos;t be undone.
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              background: S.meaning.error.accent, color: "#FFFFFF", border: "none", borderRadius: 10,
              padding: "11px 20px", fontSize: 14, fontWeight: 800, fontFamily: "inherit",
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Deleting…" : `Delete ${n}`}
          </button>
          <button onClick={onCancel} disabled={busy} style={secondaryBtn}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
  color: S.meaning.replied.ink, marginBottom: 6,
}
const h1Style: React.CSSProperties = {
  fontSize: 34, fontWeight: 800, letterSpacing: -0.6, color: S.text.primary, margin: 0,
}
const primarySize: React.CSSProperties = {
  borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontFamily: "inherit",
}
const secondaryBtn: React.CSSProperties = {
  background: S.card, color: S.text.primary, border: `1px solid ${S.border}`,
  borderRadius: 10, padding: "12px 20px", fontSize: 14.5, fontWeight: 800,
  cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit", boxShadow: S.shadow.card,
}
const quietBtn: React.CSSProperties = {
  background: "none", border: "none", color: S.action.quietInk,
  fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", padding: "6px 4px",
}
const searchStyle: React.CSSProperties = {
  width: "100%", background: S.card, border: `1px solid ${S.border}`,
  borderRadius: 10, padding: "12px 16px 12px 42px", fontSize: 14.5, color: S.text.primary,
  fontFamily: "inherit", outline: "none", boxShadow: S.shadow.card,
}
const selectStyle: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.border}`, borderRadius: 10,
  padding: "12px 14px", fontSize: 14, fontWeight: 700, color: S.text.primary,
  fontFamily: "inherit", cursor: "pointer", boxShadow: S.shadow.card,
}
const chipStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: S.meaning.progress.fill, color: S.meaning.progress.ink,
  borderRadius: 999, padding: "6px 8px 6px 14px", fontSize: 13, fontWeight: 700,
}
const chipClearStyle: React.CSSProperties = {
  background: "none", border: "none", color: "inherit", cursor: "pointer",
  fontSize: 16, lineHeight: 1, padding: "0 4px", fontFamily: "inherit",
}
const selectBarStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, marginTop: 14,
  padding: "10px 16px", borderRadius: 12,
  background: S.card, border: `1px solid ${S.borderSoft}`, boxShadow: S.shadow.card,
}
const noticeStyle: React.CSSProperties = {
  marginTop: 16, padding: "12px 16px", borderRadius: 12, display: "flex",
  alignItems: "center", gap: 10,
  background: S.card, border: `1px solid ${S.borderSoft}`, boxShadow: S.shadow.card,
}
const dismissStyle: React.CSSProperties = {
  background: "none", border: "none", color: S.text.dim, fontSize: 18,
  cursor: "pointer", fontFamily: "inherit", lineHeight: 1,
}
const emptyStyle: React.CSSProperties = {
  marginTop: 20, padding: "36px 28px", textAlign: "center",
  border: `1px dashed ${S.border}`, borderRadius: 14,
  color: S.text.muted, fontSize: 14.5, background: "rgba(255,255,255,0.5)",
}
const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, background: "rgba(19,41,74,0.45)", display: "flex",
  alignItems: "flex-start", justifyContent: "center", padding: "16vh 16px", zIndex: 50,
}
const panelStyle: React.CSSProperties = {
  background: S.card, border: `1px solid ${S.borderSoft}`, borderRadius: 18,
  padding: 26, width: "100%", maxWidth: 470, boxShadow: S.shadow.raised,
}
