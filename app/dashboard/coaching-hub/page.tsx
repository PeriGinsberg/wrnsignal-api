"use client"

// Coaching Hub — the client-facing (D2C) landing for everything a coach shares
// with this coached account. It presents the engagement as a sequenced plan: the
// plan (deliverable-grouped activities, in sort_order) is the primary surface,
// with the shared document Library beneath it. This is a growable AREA: the page
// composes a vertical stack of self-contained sections, and more coached content
// (future slices) slots in as additional sections here — no new nav item, no
// restructure.
//
// The Hub PRESENTS existing order, it does not rebuild it: MyPlanSection renders
// deliverables and activities exactly as /api/me/activities returns them, which is
// ordered by sort_order end-to-end (catalog → freeze → read).
//
// Read-only. The page owns the /api/me/activities fetch + status writes ONCE and
// feeds both the Action Items zone and the plan from that single source (completing
// an item updates both live); the document Library still owns its own fetch. Auth
// is the client bearer pattern
// (same as the Job Tracker). The real access guard is the API: /api/me/documents
// and /api/me/activities scope to the caller's own profile, so a non-coached user
// who reaches this URL directly simply sees the empty state — never an error,
// never another client's data. The nav hides this for non-coached users; this
// page does not re-check (nav-hiding isn't access control — the API is).

import { useCallback, useEffect, useRef, useState } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import { T, card, headline, btnSecondary } from "../../../lib/dashboard-theme"

type SharedDoc = { id: string; title: string; url: string }
type DocGroup = { category_id: string | null; name: string; documents: SharedDoc[] }

type PlanNote = { id: string; body: string; action_required: boolean; created_at: string; client_done_at: string | null }
type PlanActivity = { id: string; name: string; status: string; owner: string; due_date: string | null; notes: PlanNote[] }
type PlanGroup = { deliverable_id: string; name: string; activities: PlanActivity[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// Format a DATE value ("2026-07-01") to "Jul 1" — parsed from parts so a date-only
// value never timezone-shifts a day. Returns "" for null/garbage (chip hidden).
function fmtDue(d: string | null): string {
  if (!d) return ""
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!m) return ""
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`
}

// Format an ISO timestamp (e.g. coach_job_recommendations.created_at) to
// "MMM D" in local time — for the "Sent" date on Required Actions cards.
// (fmtDue above only handles date-only YYYY-MM-DD values.) Returns "" for
// null/garbage so the line is hidden.
function fmtSent(iso: string | null): string {
  if (!iso) return ""
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return ""
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`
}

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

export default function CoachingHubPage() {
  // Single source of truth for /api/me/activities — fed to both the Action Items
  // zone and the plan. (Lifted from MyPlanSection unchanged; same optimistic
  // update + resync-on-fail.)
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
    <div style={{ maxWidth: 820 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ ...headline, marginBottom: 6 }}>Coaching Hub</h1>
        <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
          Your coaching plan — work through it with your coach.
        </p>
      </div>

      {/* Stacked sections — single scrolling page, top to bottom. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <RequiredActionsSection groups={groups} />
        <MyPlanSection
          groups={groups}
          loading={loading}
          loadError={loadError}
          actionError={actionError}
          settingId={settingId}
          onRetry={load}
          onSetStatus={setStatus}
        />
        <SharedDocumentsSection />
      </div>
    </div>
  )
}

// ── Required Actions — the client's single "what should I do next" list ──────
// Built as a list of action PROVIDERS so future item types append without
// restructuring: each provider fetches its own source and maps to the shared
// RequiredAction shape; the section concatenates them. v1 ships ONE provider —
// unreviewed coach-sourced jobs (coach_job_recommendations, client_status='new').
// Read-and-jump: the card deep-links into the Job Tracker, where Apply/Pass
// already lives; responding there flips client_status off 'new', so the item
// clears on the next load. No write path here.
type RequiredAction = {
  id: string
  kind: string
  label: string
  title: string
  subtitle: string | null
  note: string | null
  decision: string | null
  score: number | null
  href: string
  sentAt: string | null
  doneEndpoint?: string
}

type ProviderContext = { token: string; groups: PlanGroup[] }

type ActionProvider = {
  kind: string
  load: (ctx: ProviderContext) => Promise<RequiredAction[]>
}

// Provider: unreviewed coach-sourced jobs. Reuses the existing client endpoint
// /api/coach/my-recommendations (returns all recs for this client); keep only
// the unanswered ones that have a tracker job to open.
const unreviewedSourcedJobs: ActionProvider = {
  kind: "sourced_job",
  load: async ({ token }) => {
    const res = await fetch("/api/coach/my-recommendations", { headers: { Authorization: `Bearer ${token}` } })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || !j?.ok) throw new Error(j?.error || `Couldn't load recommendations (${res.status})`)
    return (j.recommendations || [])
      .filter((r: any) => r.client_status === "new" && r.application_id)
      .map((r: any) => ({
        id: r.id,
        kind: "sourced_job",
        label: "Review the job your coach sent",
        title: r.job_title || "Untitled role",
        subtitle: r.company_name || null,
        note: r.coaching_note || null,
        decision: r.signal_decision || null,
        score: typeof r.signal_score === "number" ? r.signal_score : null,
        href: `/dashboard/tracker?job=${r.application_id}`,
        sentAt: r.created_at || null,
      }))
  },
}

// Provider: coach action-required activity notes. Sourced from the activities
// the page already loaded (no extra fetch) — an item appears when a visible
// note is flagged action_required, its activity isn't complete, and the client
// hasn't marked it done. The card carries a doneEndpoint, so it renders a
// "Mark done" button (PATCH client_done_at) instead of a link; that
// acknowledgement is coach-visible and clears the card.
const coachActionRequiredNotes: ActionProvider = {
  kind: "activity_note",
  load: async ({ groups }) =>
    groups.flatMap((g) =>
      g.activities
        .filter((a) => a.status !== "complete")
        .flatMap((a) =>
          a.notes
            .filter((n) => n.action_required && !n.client_done_at)
            .map((n) => ({
              id: n.id,
              kind: "activity_note",
              label: "Your coach needs something from you",
              title: n.body,
              subtitle: null,
              note: null,
              decision: null,
              score: null,
              sentAt: null,
              href: "",
              doneEndpoint: `/api/me/activity-notes/${n.id}/done`,
            })),
        ),
    ),
}

const ACTION_PROVIDERS: ActionProvider[] = [unreviewedSourcedJobs, coachActionRequiredNotes]

function RequiredActionsSection({ groups }: { groups: PlanGroup[] }) {
  const [actions, setActions] = useState<RequiredAction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Show "Loading…" only on the first run; later re-runs (when the page's plan
  // data changes) update the list silently instead of flashing.
  const firstLoad = useRef(true)
  const [doingId, setDoingId] = useState<string | null>(null)

  async function markDone(a: RequiredAction) {
    if (!a.doneEndpoint || doingId) return
    setDoingId(a.id)
    setLoadError(null)
    try {
      const token = await getToken()
      if (!token) { setLoadError("Please sign in again."); return }
      const res = await fetch(a.doneEndpoint, { method: "PATCH", headers: { Authorization: `Bearer ${token}` } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setLoadError(j?.error || `Couldn't mark that done (${res.status})`); return }
      setActions((prev) => prev.filter((x) => !(x.kind === a.kind && x.id === a.id)))
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setDoingId(null)
    }
  }

  const load = useCallback(async () => {
    if (firstLoad.current) setLoading(true)
    setLoadError(null)
    try {
      const token = await getToken()
      if (!token) { setLoadError("Please sign in again."); return }
      const results = await Promise.all(ACTION_PROVIDERS.map((p) => p.load({ token, groups })))
      setActions(results.flat())
    } catch (e: any) {
      setLoadError(e?.message || "Network error — try again")
    } finally {
      firstLoad.current = false
      setLoading(false)
    }
  }, [groups])

  useEffect(() => { void load() }, [load])

  return (
    <section style={{ ...card, padding: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 14 }}>
        Required Actions
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
      ) : actions.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: 0, lineHeight: 1.5 }}>
          You’re all caught up — no actions need your attention right now.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {actions.map((a) => {
            const cardStyle: React.CSSProperties = {
              display: "block", textDecoration: "none",
              padding: "12px 14px", borderRadius: 12,
              border: `1px solid ${T.NAV_ACTIVE_BORDER}`, background: T.WARNING_BG,
            }
            const inner = (
              <>
                <span style={{ display: "block", fontSize: 11, fontWeight: 800, color: T.WRN_ORANGE, marginBottom: 4 }}>
                  {a.label}
                </span>
                <span style={{ display: "block", fontSize: 14, color: T.TEXT, fontWeight: 700, wordBreak: "break-word" }}>
                  {a.title}
                  {a.subtitle && <span style={{ color: T.MUTED, fontWeight: 500 }}> · {a.subtitle}</span>}
                </span>
                {(a.decision || a.score !== null) && (
                  <span style={{ display: "block", fontSize: 12, color: T.MUTED, marginTop: 4 }}>
                    {a.decision}{a.decision && a.score !== null ? " · " : ""}{a.score !== null ? `Score ${a.score}` : ""}
                  </span>
                )}
                {fmtSent(a.sentAt) && (
                  <span style={{ display: "block", fontSize: 11, color: T.DIM, marginTop: 4 }}>
                    Sent {fmtSent(a.sentAt)}
                  </span>
                )}
                {a.note && (
                  <span style={{ display: "block", fontSize: 13, color: T.MUTED, marginTop: 6, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word", borderLeft: `2px solid ${T.BORDER}`, paddingLeft: 10 }}>
                    {a.note}
                  </span>
                )}
              </>
            )
            // Items with a write action (coach action-required notes) render as a
            // dismissible card with a "Mark done" button instead of a link.
            if (a.doneEndpoint) {
              return (
                <div key={`${a.kind}:${a.id}`} style={cardStyle}>
                  {inner}
                  <button
                    type="button"
                    disabled={doingId === a.id}
                    onClick={() => void markDone(a)}
                    style={{ ...btnSecondary, marginTop: 10, fontSize: 12, padding: "6px 14px", borderRadius: 8, opacity: doingId === a.id ? 0.6 : 1 }}
                  >
                    {doingId === a.id ? "Marking…" : "Mark done"}
                  </button>
                </div>
              )
            }
            return (
              <a key={`${a.kind}:${a.id}`} href={a.href} style={cardStyle}>
                {inner}
              </a>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Section: My Plan — the client's own engagement activities. Presentational:
//    the page owns the fetch + status writes (lifted); this renders exactly as
//    before, sourcing state + handlers from props. ──
function MyPlanSection({
  groups, loading, loadError, actionError, settingId, onRetry, onSetStatus,
}: {
  groups: PlanGroup[]
  loading: boolean
  loadError: string | null
  actionError: string | null
  settingId: string | null
  onRetry: () => void
  onSetStatus: (id: string, status: string) => void
}) {
  // Collapse-by-default: show only the first milestone group; "Show all"
  // reveals the rest. Local to this section (not lifted). No toggle when
  // there's 0–1 group (nothing to expand).
  const [expanded, setExpanded] = useState(false)
  const visibleGroups = expanded ? groups : groups.slice(0, 1)
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
          <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void onRetry()}>Retry</button>
        </div>
      ) : groups.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: 0, lineHeight: 1.5 }}>
          No plan items assigned to you yet — your coach will add them here.
        </p>
      ) : (
        <>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {visibleGroups.map((g) => (
            <div key={g.deliverable_id}>
              <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 8 }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.activities.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex", flexDirection: "column", gap: 8,
                      padding: "10px 12px", borderRadius: 12,
                      border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                      <span style={{ flex: 1, minWidth: 160, fontSize: 14, color: T.TEXT, fontWeight: 600, wordBreak: "break-word" }}>
                        {a.name}
                        {a.owner === "both" && (
                          <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.DIM }}>
                            shared with coach
                          </span>
                        )}
                      </span>
                      {a.due_date && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: T.WRN_BLUE, whiteSpace: "nowrap" }}>
                          Due {fmtDue(a.due_date)}
                        </span>
                      )}
                      <ActivityStatusControl
                        value={a.status}
                        busy={settingId === a.id}
                        onSet={(s) => void onSetStatus(a.id, s)}
                      />
                    </div>
                    {/* Coach notes shared with the client — read-only, newest-first.
                        action_required is carried but its surfacing is Slice 5. */}
                    {a.notes.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {a.notes.map((n) => (
                          <div
                            key={n.id}
                            style={{
                              fontSize: 13, color: T.MUTED, lineHeight: 1.45, whiteSpace: "pre-wrap",
                              wordBreak: "break-word", borderLeft: `2px solid ${T.BORDER}`, paddingLeft: 10,
                            }}
                          >
                            {n.body}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {groups.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              marginTop: 16, background: "none", border: "none", padding: 0,
              fontSize: 12, fontWeight: 700, color: T.WRN_BLUE, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {expanded
              ? "Show less"
              : `Show all (${groups.flatMap((g) => g.activities).length} activities)`}
          </button>
        )}
        </>
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
