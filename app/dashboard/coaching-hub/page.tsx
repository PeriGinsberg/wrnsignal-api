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
import {
  LIGHT as S, action as actionStyle,
  surfaceCard,
} from "../../../lib/theme/surfaces"
import { SectionState } from "./SectionState"
import { ActivityStatus } from "./ActivityStatus"

type SharedDoc = { id: string; title: string; url: string }
type DocGroup = { category_id: string | null; name: string; documents: SharedDoc[] }

type PlanNote = { id: string; body: string; action_required: boolean; created_at: string; client_done_at: string | null }
// No `owner` field: /api/me/activities still returns one (and still filters on
// it server-side — owner='coach' activities never reach this page), but nothing
// here reads it now that the plan rows carry no coach marker.
type PlanActivity = { id: string; name: string; status: string; due_date: string | null; notes: PlanNote[] }
type PlanGroup = { deliverable_id: string; name: string; activities: PlanActivity[] }

const eyebrow: React.CSSProperties = {
  fontSize: 12, fontWeight: 800, letterSpacing: 1.4, textTransform: "uppercase",
}

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

/**
 * The way in to the Proof Project page — and the only one, since the nav is a
 * fixed list that cannot know whether this client has a flagged engagement.
 *
 * It asks the API rather than being told by the parent because the parent reads
 * /api/me/activities, which deliberately knows nothing about proof projects.
 * The cost is one extra request on hub load; the alternative is widening the
 * plan endpoint with a field only this banner uses.
 *
 * SILENT ON EVERY FAILURE. No project, not coached, request failed, still
 * loading — all render nothing. A broken banner promising a page that may not
 * exist is worse than no banner, and this is an entry point, not content.
 */
function ProofProjectEntry() {
  const [project, setProject] = useState<{ name: string; percent: number } | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await fetch("/api/me/proof-project", { headers: { Authorization: `Bearer ${token}` } })
        const j = await res.json().catch(() => ({}))
        if (!mounted || !res.ok || !j?.ok || !j.project) return
        const acts = (j.project.deliverables ?? []).flatMap((d: { activities?: unknown[] }) => d.activities ?? [])
        const total = acts.length
        const done = acts.filter((a: { status?: string }) => a?.status === "complete").length
        // Same never-round-up-to-100 rule as the page itself.
        const percent = total === 0 ? 0 : done === total ? 100 : Math.min(99, Math.floor((done / total) * 100))
        setProject({ name: j.project.name, percent })
      } catch {
        /* silent — see the note above */
      }
    })()
    return () => { mounted = false }
  }, [])

  if (!project) return null

  return (
    <a
      href="/dashboard/coaching-hub/proof-project"
      style={{
        display: "block", textDecoration: "none",
        background: S.hero.background, borderRadius: 16, padding: "22px 24px",
      }}
    >
      {/* The NAVY HERO, and the same progress bar the Profile page uses for its
          completion. The peach gradient card and the 34px peach numeral this
          replaces broke two rules at once: peach is action only, and a second
          percent treatment in the product means two things to learn for one
          idea.

          Still a link, unlike Profile's static hero — this banner is the only
          route to the proof-project page, since the nav is a fixed list that
          cannot know whether a client has a flagged engagement. */}
      <div style={{ ...eyebrow, color: S.hero.muted }}>Proof Project</div>
      <div style={{ marginTop: 8, fontSize: 19, fontWeight: 800, color: S.hero.ink, overflowWrap: "anywhere" }}>
        {project.name}
      </div>
      <div style={{ height: 9, borderRadius: 999, background: "rgba(255,255,255,0.14)", marginTop: 14 }}>
        <div style={{ width: `${project.percent}%`, height: "100%", borderRadius: 999, background: S.hero.accent }} />
      </div>
      <div style={{ marginTop: 10, fontSize: 14.5, color: S.hero.muted }}>
        {project.percent}% complete — see the whole journey →
      </div>
    </a>
  )
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
    <main style={{ maxWidth: 1080 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.5, color: S.text.primary, margin: 0, marginBottom: 6 }}>Coaching Hub</h1>
        <p style={{ fontSize: 15, color: S.text.muted, margin: 0 }}>
          Your coaching plan — work through it with your coach.
        </p>
      </div>

      {/* Stacked sections — single scrolling page, top to bottom. */}
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <RequiredActionsSection groups={groups} />
        {/* Below Required Actions on purpose: this is the motivating surface,
            but a coach asking for something is still the more urgent thing on
            the page. Renders nothing at all unless a proof project exists. */}
        <ProofProjectEntry />
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
    </main>
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
  context?: string
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
// Exported for RequiredActionsLink.test.tsx: the mapping is where the
// destination is decided, and asserting it needs one mocked fetch rather
// than the whole page's three.
export const unreviewedSourcedJobs: ActionProvider = {
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
        // Straight to the job. It used to go to /dashboard/tracker?job={id},
        // which the tracker then client-side redirected to the detail route —
        // the same one-hop indirection removed from the Dashboard nudges.
        href: `/dashboard/tracker/${r.application_id}`,
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
              context: a.name,
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
    <section style={{ ...surfaceCard(S), padding: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: S.text.muted, marginBottom: 16 }}>
        Required Actions
      </div>
      <SectionState
        loading={loading}
        error={loadError}
        isEmpty={actions.length === 0}
        emptyText="You’re all caught up — no actions need your attention right now."
        onRetry={() => void load()}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {actions.map((a) => {
            const cardStyle: React.CSSProperties = {
              display: "block", textDecoration: "none",
              padding: "14px 16px", borderRadius: 12,
              border: `1px solid ${S.meaning.attention.accent}`, background: S.meaning.attention.fill,
            }
            const inner = (
              <>
                <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: S.meaning.attention.ink, marginBottom: 5 }}>
                  {a.label}
                </span>
                <span style={{ display: "block", fontSize: 15.5, color: S.text.primary, fontWeight: 700, wordBreak: "break-word" }}>
                  {a.title}
                  {a.subtitle && <span style={{ color: S.text.secondary, fontWeight: 500 }}> · {a.subtitle}</span>}
                </span>
                {a.context && (
                  <span style={{ display: "block", fontSize: 13, color: S.text.muted, marginTop: 3 }}>
                    {a.context}
                  </span>
                )}
                {(a.decision || a.score !== null) && (
                  <span style={{ display: "block", fontSize: 13.5, color: S.text.secondary, marginTop: 5 }}>
                    {a.decision}{a.decision && a.score !== null ? " · " : ""}{a.score !== null ? `Score ${a.score}` : ""}
                  </span>
                )}
                {fmtSent(a.sentAt) && (
                  <span style={{ display: "block", fontSize: 13, color: S.text.muted, marginTop: 5 }}>
                    Sent {fmtSent(a.sentAt)}
                  </span>
                )}
                {a.note && (
                  <span style={{ display: "block", fontSize: 14, color: S.text.secondary, marginTop: 8, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word", borderLeft: `2px solid ${S.borderSoft}`, paddingLeft: 12 }}>
                    {a.note}
                  </span>
                )}
              </>
            )
            // Items with a write action (coach action-required notes) render as a
            // dismissible card with a "Mark done" button instead of a link.
            if (a.doneEndpoint) {
              return (
                <div
                  key={`${a.kind}:${a.id}`}
                  style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>{inner}</div>
                  <button
                    type="button"
                    disabled={doingId === a.id}
                    onClick={() => void markDone(a)}
                    style={{
                      ...actionStyle(S, "primary"), flexShrink: 0, fontSize: 13.5,
                      padding: "8px 14px", borderRadius: 10, fontFamily: "inherit",
                      whiteSpace: "nowrap", opacity: doingId === a.id ? 0.6 : 1,
                    }}
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
      </SectionState>
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
    <section style={{ ...surfaceCard(S), padding: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: S.text.muted, marginBottom: 16 }}>
        My Plan
      </div>

      {/* A WRITE error, not a load error: the plan is on screen and one status
          change failed. It sits above the plan rather than replacing it, which
          is why it is not part of SectionState. */}
      {actionError && (
        <div style={{
          marginBottom: 16, fontSize: 14, color: S.meaning.error.ink,
          background: S.meaning.error.fill, border: `1px solid ${S.meaning.error.accent}`,
          borderRadius: 12, padding: "12px 14px",
        }}>
          {actionError}
        </div>
      )}

      <SectionState
        loading={loading}
        error={loadError}
        isEmpty={groups.length === 0}
        emptyText="No plan items assigned to you yet — your coach will add them here."
        onRetry={() => void onRetry()}
      >
        <>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {visibleGroups.map((g) => (
            <div key={g.deliverable_id}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: S.text.muted, marginBottom: 10 }}>
                {g.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.activities.map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "flex", flexDirection: "column", gap: 8,
                      padding: "10px 12px", borderRadius: 12,
                      // The receded-row background the converted screens already
                      // use (ContactCard, ApplicationCard, HistoryView). Not a
                      // token yet in any of them; kept consistent rather than
                      // inventing a fifth spelling here.
                      border: `1px solid ${S.borderSoft}`, background: "#FBFDFE",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
                      <span style={{ flex: 1, minWidth: 180, fontSize: 15.5, color: S.text.primary, fontWeight: 700, wordBreak: "break-word" }}>
                        {a.name}
                      </span>
                      {a.due_date && (
                        <span style={{ fontSize: 13, fontWeight: 700, color: S.meaning.progress.ink, whiteSpace: "nowrap" }}>
                          Due {fmtDue(a.due_date)}
                        </span>
                      )}
                      <ActivityStatus
                        value={a.status}
                        busy={settingId === a.id}
                        onSet={(s) => void onSetStatus(a.id, s)}
                      />
                    </div>
                    {/* NO "From your coach" MARKER HERE, deliberately (removed
                        2026-08-10). Every activity on this plan is the coach's —
                        the plan IS the coach's work — so marking the owner='both'
                        subset flagged nothing and implied the unmarked rows came
                        from somewhere else. The marker still earns its place on
                        the Job Tracker, where a coach-sourced job sits among jobs
                        the client added themselves. */}
                    {/* Informational coach notes only — read-only, newest-first.
                        action_required notes live in Required Actions (one home
                        per action note), so they're filtered out here regardless
                        of done state. */}
                    {a.notes.filter((n) => !n.action_required).length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {a.notes.filter((n) => !n.action_required).map((n) => (
                          <div
                            key={n.id}
                            style={{
                              fontSize: 14, color: S.text.secondary, lineHeight: 1.5, whiteSpace: "pre-wrap",
                              wordBreak: "break-word", borderLeft: `2px solid ${S.borderSoft}`, paddingLeft: 12,
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
              fontSize: 14, fontWeight: 700, color: S.action.quietInk, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {expanded
              ? "Show less"
              : `Show all (${groups.flatMap((g) => g.activities).length} activities)`}
          </button>
        )}
        </>
      </SectionState>
    </section>
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
    <section style={{ ...surfaceCard(S), padding: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", color: S.text.muted, marginBottom: 16 }}>
        Shared documents
      </div>

      <SectionState
        loading={loading}
        error={loadError}
        isEmpty={groups.length === 0}
        emptyText="Your coach hasn’t shared any tools or documents with you yet."
        onRetry={() => void load()}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {groups.map((g) => (
            <div key={g.category_id ?? "__uncategorized__"}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: S.text.muted, marginBottom: 10 }}>
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
                      // The receded-row background the converted screens already
                      // use (ContactCard, ApplicationCard, HistoryView). Not a
                      // token yet in any of them; kept consistent rather than
                      // inventing a fifth spelling here.
                      border: `1px solid ${S.borderSoft}`, background: "#FBFDFE",
                    }}
                  >
                    <span style={{ fontSize: 15.5, color: S.text.primary, fontWeight: 700, wordBreak: "break-word" }}>{d.title}</span>
                    <span style={{ display: "block", fontSize: 13.5, color: S.text.muted, marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {fmtHost(d.url)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SectionState>
    </section>
  )
}
