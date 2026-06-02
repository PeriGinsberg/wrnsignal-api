"use client"

// Prospect detail page (Prospects v0.1 Commit 4c).
// Renders /api/coach/prospects/[id] GET response. Scope is State A
// only: lifecycle_status='Prospect'.
//
// Architectural pivot (post-design review): the post-conversion
// (lifecycle='Active' AND client_profile_id IS NULL) state moves
// off this page and onto a future client surface built in Commit 4d
// (/dashboard/coach/coach-clients/[id]). On load, if the prospect
// is not in 'Prospect' lifecycle, we router.replace() to that
// surface — which 404s pre-4d, intentionally.
//
// Convert flow: clicking "Convert to Active" PATCHes lifecycle to
// 'Active' then router.push()es to /coach-clients/[id]. The
// post-conversion send-invite nudge moves to that new surface.
//
// Lifecycle changes always happen via dedicated buttons (Convert /
// Archive); the pill itself is a static "Prospect" chip and is not
// interactive. The LifecycleStatusPill refactor for general
// lifecycle editing lands in Commit 4d.

import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import {
  T,
  input,
  textarea,
  btnPrimary,
  btnSecondary,
  card,
  eyebrow,
  label,
} from "../../../../../lib/dashboard-theme"
import { SavingSpinner } from "../../SavingSpinner"
import { LoadingShell } from "../../LoadingShell"

// ── Constants (duplicated per inline pattern) ──

const PHASE_KEYS = [
  "initial_contact_made",
  "discovery_call_scheduled",
  "discovery_call_completed",
  "sow_sent",
  "sow_signed",
  "invoice_sent",
  "invoice_paid",
] as const
type PhaseKey = (typeof PHASE_KEYS)[number]

const PHASE_LABEL: Record<PhaseKey, string> = {
  initial_contact_made: "Initial contact made",
  discovery_call_scheduled: "Discovery call scheduled",
  discovery_call_completed: "Discovery call completed",
  sow_sent: "SOW sent",
  sow_signed: "SOW signed",
  invoice_sent: "Invoice sent",
  invoice_paid: "Invoice paid",
}

const SOURCE_CATEGORIES = [
  "referral",
  "social_media",
  "website",
  "personal_contact",
  "other",
] as const
type SourceCategory = (typeof SOURCE_CATEGORIES)[number]

const SOURCE_LABEL: Record<SourceCategory, string> = {
  referral: "Referral",
  social_media: "Social Media",
  website: "Website",
  personal_contact: "Personal Contact",
  other: "Other",
}

const SOURCE_STYLE: Record<SourceCategory, { bg: string; color: string; border: string }> = {
  referral:         { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5", border: "rgba(81,173,229,0.40)" },
  social_media:     { bg: "rgba(167,139,250,0.18)", color: "#C8B6F8", border: "rgba(167,139,250,0.40)" },
  website:          { bg: "rgba(45,165,141,0.15)",  color: "#2CA58D", border: "rgba(45,165,141,0.40)" },
  personal_contact: { bg: "rgba(74,222,128,0.15)",  color: "#4ade80", border: "rgba(74,222,128,0.40)" },
  other:            { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)", border: "rgba(255,255,255,0.18)" },
}

// ── Note constants (mirror app/dashboard/coach/clients/[clientId]/NotesTab.tsx
//    for visual parity. Duplicated inline per the established coach-route
//    pattern rather than extracted to a shared module.) ──

const NOTE_TYPES = ["session_recap", "action_item", "other"] as const
type NoteType = (typeof NOTE_TYPES)[number]

const NOTE_PRIORITIES = ["urgent", "this_week", "when_ready"] as const
type NotePriority = (typeof NOTE_PRIORITIES)[number]

const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  session_recap: "Session Recap",
  action_item: "Action Item",
  other: "Other",
}

const NOTE_TYPE_BADGE: Record<NoteType, { bg: string; color: string }> = {
  session_recap: { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5" },
  action_item:   { bg: "rgba(254,176,106,0.12)", color: "#FEB06A" },
  other:         { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)" },
}

const NOTE_PRIORITY_LABEL: Record<NotePriority, string> = {
  urgent: "Urgent",
  this_week: "This Week",
  when_ready: "When Ready",
}

const NOTE_PRIORITY_BADGE: Record<NotePriority, { bg: string; color: string; border: string }> = {
  urgent:     { bg: "rgba(248,113,113,0.15)", color: "#f87171", border: "rgba(248,113,113,0.4)" },
  this_week:  { bg: "rgba(254,176,106,0.15)", color: "#FEB06A", border: "rgba(254,176,106,0.4)" },
  when_ready: { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5", border: "rgba(81,173,229,0.4)" },
}

const DEFAULT_NOTE_TYPE: NoteType = "session_recap"
const DEFAULT_ACTION_ITEM_PRIORITY: NotePriority = "this_week"

const NOTE_FILTER_OPTIONS: { value: "" | NoteType; label: string }[] = [
  { value: "", label: "All" },
  { value: "session_recap", label: "Session Recap" },
  { value: "action_item", label: "Action Item" },
  { value: "other", label: "Other" },
]

// ── Types ──

type PhasePair = { checked: boolean; at: string | null }

type ProspectNote = {
  id: string
  type: NoteType
  body: string
  priority: NotePriority | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// Configurable pipeline (Step 5).
type PipelineStage = {
  id: string
  stage_key: string
  label: string
  sort_order: number
  is_custom: boolean
  is_terminal: boolean
  active: boolean
}
type StageProgress = { stage_key: string; reached_at: string | null }

const PROSPECT_STATUSES = ["active", "inactive", "lost"] as const
type ProspectStatus = (typeof PROSPECT_STATUSES)[number]
const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  lost: "Lost",
}
// Distinct, obvious SELECTED colors per status (a glance tells the state):
// Active = green (T.SUCCESS), Inactive = amber "on hold" (T.WRN_ORANGE),
// Lost = red (the file's error red #f87171 / T.ERROR family). These are the
// selected-fill styles; non-selected pills render muted (see the control).
const PROSPECT_STATUS_STYLE: Record<ProspectStatus, { bg: string; color: string; border: string }> = {
  active:   { bg: "rgba(74,222,128,0.18)",  color: "#4ade80", border: "rgba(74,222,128,0.50)" },
  inactive: { bg: "rgba(254,176,106,0.18)", color: "#FEB06A", border: "rgba(254,176,106,0.50)" },
  lost:     { bg: "rgba(248,113,113,0.20)", color: "#f87171", border: "rgba(248,113,113,0.55)" },
}

type Prospect = {
  id: string
  name: string | null
  invited_email: string | null
  phone: string | null
  source_category: SourceCategory | null
  source_detail: string | null
  phases: Record<PhaseKey, PhasePair>
  lifecycle_status: string
  client_profile_id: string | null
  current_stage_key: string | null
  prospect_status: ProspectStatus | null
  stage_progress: StageProgress[]
  last_activity_at: string | null
  created_at: string | null
  notes: ProspectNote[]
}

// ── Auth helpers (inline) ──

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: {
      ...(opts.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(opts.body && typeof opts.body === "string" ? { "Content-Type": "application/json" } : {}),
    },
  })
}

// ── Helpers ──

function timeAgo(iso: string | null): string {
  if (!iso) return ""
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return "Just now"
  const d = Math.floor(ms / (24 * 60 * 60 * 1000))
  if (d === 0) return "Today"
  if (d === 1) return "Yesterday"
  if (d < 7) return `${d}d ago`
  if (d < 30) return `${Math.floor(d / 7)}w ago`
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// ── Section wrapper ──

function Section({
  title,
  count,
  headerRight,
  children,
}: {
  title: string
  count?: string
  headerRight?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div style={{ ...card, padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: T.TEXT, letterSpacing: -0.2 }}>
          {title}
        </span>
        {count && (
          <span style={{ fontSize: 12, color: T.DIM, fontWeight: 700 }}>{count}</span>
        )}
        {headerRight && <span style={{ marginLeft: "auto" }}>{headerRight}</span>}
      </div>
      {children}
    </div>
  )
}

// ── Prospect status control (Active / Inactive / Lost) ──
// Won is NEVER offered here — it is automatic on convert (§4). If the prospect
// somehow carries 'won' (shouldn't on a lifecycle=Prospect row), it renders as
// a read-only chip.
function ProspectStatusControl({
  status,
  busy,
  onSet,
}: {
  status: ProspectStatus | null
  busy: boolean
  onSet: (next: ProspectStatus) => void
}) {
  // NULL prospect_status renders as the implicit "active" default — consistent
  // with the prospects list, so list and detail agree (no DB/API default).
  const effective: ProspectStatus = status ?? "active"
  // Hover affordance so the non-selected pills read as interactive (they're a
  // clickable toggle group). Inline styles can't use :hover, so track it in
  // state (same onMouseEnter/Leave pattern used elsewhere on this page).
  const [hovered, setHovered] = useState<ProspectStatus | null>(null)
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {PROSPECT_STATUSES.map((s) => {
        const active = effective === s
        const isHover = hovered === s && !active && !busy
        const st = PROSPECT_STATUS_STYLE[s]
        return (
          <button
            key={s}
            onClick={() => { if (!active && !busy) onSet(s) }}
            onMouseEnter={() => { if (!busy) setHovered(s) }}
            onMouseLeave={() => setHovered(null)}
            disabled={busy}
            style={{
              background: active ? st.bg : isHover ? T.GLASS : T.NAV_DEFAULT_BG,
              border: `1px solid ${active ? st.border : isHover ? T.BORDER : T.BORDER_SOFT}`,
              color: active ? st.color : isHover ? T.TEXT : T.MUTED,
              borderRadius: 999,
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 800,
              cursor: active || busy ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: busy ? 0.6 : 1,
              transition: "all 120ms ease",
            }}
          >
            {PROSPECT_STATUS_LABEL[s]}
          </button>
        )
      })}
    </div>
  )
}

// ── Stage tracker (configurable pipeline, §8.2) ──
// Renders the coach's ACTIVE stages in order. A stage is "reached" when it has
// a progress row. Clicking an unreached stage advances TO it (fills the path:
// every earlier unreached stage is marked too). The terminal Convert stage
// renders distinct at the end as a button-with-confirmation, not a silent click.
function StageTracker({
  stages,
  reachedMap,
  currentStageKey,
  busyKey,
  converting,
  onAdvance,
  onConvert,
}: {
  stages: PipelineStage[]
  reachedMap: Record<string, string | null>
  currentStageKey: string | null
  busyKey: string | null
  converting: boolean
  onAdvance: (stageKey: string) => void
  onConvert: () => void
}) {
  const working = stages.filter((s) => !s.is_terminal)
  const terminal = stages.find((s) => s.is_terminal)
  // Hover affordance for the CLICKABLE (unreached) nodes only — signals the
  // band is a control, not a static display. Reached nodes are no-op (backward
  // not supported), so they never get the hover cue.
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const hasUnreached = working.some((s) => !(s.stage_key in reachedMap))

  return (
    <div>
      {hasUnreached && (
        <p style={{ fontSize: 11, color: T.DIM, margin: "0 0 12px" }}>
          Click a stage to advance — the path fills automatically.
        </p>
      )}
      {/* Horizontal stepper band. APPROACH: overflow-x scroll keeps the
          connected stepper as one continuous row with clean connectors; on
          narrow viewports (and with ~15 stages) it scrolls sideways rather
          than wrapping, so connectors never break and nodes never squash.
          minWidth:min-content prevents the band from compressing. */}
      <div style={{ overflowX: "auto", paddingBottom: 6, marginBottom: terminal ? 14 : 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", minWidth: "min-content" }}>
          {working.map((s, i) => {
            const reached = s.stage_key in reachedMap
            const isCurrent = currentStageKey === s.stage_key
            const reachedAt = reachedMap[s.stage_key] ?? null
            const busy = busyKey === s.stage_key
            // Hover only applies to clickable (unreached, not-busy) nodes.
            const isHover = hoveredKey === s.stage_key && !reached && !busy
            // Current is always reached (furthest-reached pointer); highlight it
            // in orange, other reached nodes in green, unreached muted — and an
            // unreached node brightens on hover to signal it's clickable.
            const circleColor = isCurrent ? T.WRN_ORANGE : reached ? T.SUCCESS : isHover ? T.TEXT : T.DIM
            const circleBorder = isCurrent ? T.WRN_ORANGE : reached ? "rgba(74,222,128,0.5)" : isHover ? T.MUTED : T.BORDER
            const circleBg = isCurrent ? T.NAV_ACTIVE_BG : reached ? "rgba(74,222,128,0.18)" : isHover ? T.GLASS : "transparent"
            const labelColor = isCurrent ? T.WRN_ORANGE : reached ? T.TEXT : isHover ? T.TEXT : T.MUTED
            return (
              <Fragment key={s.stage_key}>
                {/* Connector to the previous node — filled green once this node
                    is reached (the path up to here is complete). */}
                {i > 0 && (
                  <div
                    aria-hidden
                    style={{
                      flex: "0 0 28px",
                      height: 2,
                      marginTop: 13,
                      background: reached ? "rgba(74,222,128,0.5)" : T.BORDER_SOFT,
                    }}
                  />
                )}
                <button
                  onClick={() => { if (!reached && !busy) onAdvance(s.stage_key) }}
                  onMouseEnter={() => { if (!reached && !busy) setHoveredKey(s.stage_key) }}
                  onMouseLeave={() => setHoveredKey(null)}
                  disabled={busy || reached}
                  title={reached ? (reachedAt ? `Reached ${timeAgo(reachedAt)}` : "Reached") : `Advance to ${s.label}`}
                  style={{
                    flex: "0 0 auto",
                    width: 92,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    background: "transparent",
                    border: "none",
                    padding: "0 4px",
                    fontFamily: "inherit",
                    cursor: reached || busy ? "default" : "pointer",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 28, height: 28, borderRadius: 999, flexShrink: 0,
                      display: "inline-flex", alignItems: "center", justifyContent: "center",
                      fontSize: 12, fontWeight: 900,
                      border: `1px solid ${circleBorder}`,
                      background: circleBg,
                      color: circleColor,
                      transition: "all 120ms ease",
                    }}
                  >
                    {busy ? <SavingSpinner size={10} /> : reached ? "✓" : i + 1}
                  </span>
                  <span
                    style={{
                      fontSize: 11, lineHeight: "14px", textAlign: "center",
                      color: labelColor,
                      fontWeight: isCurrent ? 800 : reached ? 700 : 500,
                      transition: "color 120ms ease",
                    }}
                  >
                    {s.label}
                  </span>
                  {s.is_custom && (
                    <span style={{ fontSize: 8, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.WRN_BLUE, border: `1px solid ${T.WRN_BLUE}`, borderRadius: 5, padding: "0 4px" }}>
                      custom
                    </span>
                  )}
                  {reached && reachedAt && (
                    <span style={{ fontSize: 9, color: T.DIM }}>{timeAgo(reachedAt)}</span>
                  )}
                </button>
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* Terminal Convert — distinct final action (button-with-confirmation),
          set apart below the stepper, NOT a plain node. Behavior unchanged. */}
      {terminal && (
        <div
          style={{
            padding: "14px 14px",
            borderRadius: 12,
            border: `1px solid ${T.NAV_ACTIVE_BORDER}`,
            background: "rgba(33,140,140,0.10)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: T.TEXT }}>{terminal.label}</div>
            <div style={{ fontSize: 11, color: T.MUTED, marginTop: 2 }}>
              Creates the client account and moves them out of prospects.
            </div>
          </div>
          <button
            onClick={onConvert}
            disabled={converting}
            style={{
              background: T.GRAD_PRIMARY,
              color: "#04060F",
              borderRadius: 10,
              padding: "9px 16px",
              fontSize: 13,
              fontWeight: 800,
              border: "none",
              fontFamily: "inherit",
              cursor: converting ? "wait" : "pointer",
              opacity: converting ? 0.5 : 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
            }}
          >
            {converting && <SavingSpinner size={10} />}
            {converting ? "Converting…" : `${terminal.label} →`}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Prospect Information block (click-to-edit) ──
// View mode matches the post-conversion "Client Information" block on
// coach-clients/[id] (labeled-columns grid via InfoRow + formatDate). The Edit
// button reveals the existing editable form — editing is preserved.

// Labeled column, matching coach-clients/[id]'s InfoRow.
function InfoRow({ label: rowLabel, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ ...label, color: T.WRN_BLUE, fontSize: 10 }}>{rowLabel}</span>
      <span style={{ fontSize: 13, color: T.TEXT }}>{value}</span>
    </div>
  )
}

// Long-form date, matching coach-clients/[id]'s formatDate ("ADDED AS PROSPECT").
function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
}

function SourceSection({
  category,
  detail,
  invitedEmail,
  phone,
  createdAt,
  lastActivityAt,
  onSave,
}: {
  category: SourceCategory | null
  detail: string | null
  invitedEmail: string | null
  phone: string | null
  createdAt: string | null
  lastActivityAt: string | null
  onSave: (next: { source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null; phone?: string | null }) => Promise<{ ok: true } | { ok: false; error: string }>
}) {
  const [editing, setEditing] = useState(false)
  const [editCategory, setEditCategory] = useState<SourceCategory | "">(category ?? "")
  const [editDetail, setEditDetail] = useState(detail ?? "")
  const [editEmail, setEditEmail] = useState(invitedEmail ?? "")
  const [editPhone, setEditPhone] = useState(phone ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setEditCategory(category ?? "")
    setEditDetail(detail ?? "")
    setEditEmail(invitedEmail ?? "")
    setEditPhone(phone ?? "")
    setError(null)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setError(null)
  }

  async function handleSave() {
    if (!editCategory) {
      setError("Source category is required")
      return
    }
    setSaving(true)
    setError(null)
    const updates: { source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null; phone?: string | null } = {}
    if (editCategory !== category) updates.source_category = editCategory
    const nextDetail = editDetail.trim() || null
    if (nextDetail !== detail) updates.source_detail = nextDetail
    const nextEmail = editEmail.trim() || null
    if (nextEmail !== invitedEmail) updates.invited_email = nextEmail
    const nextPhone = editPhone.trim() || null
    if (nextPhone !== phone) updates.phone = nextPhone

    if (Object.keys(updates).length === 0) {
      setEditing(false)
      setSaving(false)
      return
    }
    const res = await onSave(updates)
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setEditing(false)
  }

  if (!editing) {
    return (
      <div>
        {/* Labeled-columns grid — matches the post-conversion Client
            Information block (coach-clients/[id]). */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          <InfoRow
            label="SOURCE"
            value={
              category ? (
                <span
                  style={{
                    display: "inline-block",
                    background: SOURCE_STYLE[category].bg,
                    color: SOURCE_STYLE[category].color,
                    fontSize: 11,
                    fontWeight: 900,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    padding: "3px 10px",
                    borderRadius: 999,
                  }}
                >
                  {SOURCE_LABEL[category]}
                </span>
              ) : (
                <span style={{ color: T.DIM }}>—</span>
              )
            }
          />
          <InfoRow label="SOURCE DETAIL" value={detail || <span style={{ color: T.DIM }}>—</span>} />
          <InfoRow label="EMAIL" value={invitedEmail || <span style={{ color: T.DIM }}>—</span>} />
          <InfoRow
            label="PHONE"
            value={
              phone ? (
                <a
                  href={`tel:${phone}`}
                  style={{ color: T.TEXT, textDecoration: "none" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "underline" }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.textDecoration = "none" }}
                >
                  {phone}
                </a>
              ) : (
                <span style={{ color: T.DIM }}>—</span>
              )
            }
          />
          {createdAt && <InfoRow label="ADDED AS PROSPECT" value={formatDate(createdAt)} />}
          {lastActivityAt && <InfoRow label="LAST ACTIVITY" value={timeAgo(lastActivityAt)} />}
        </div>
        <button
          onClick={startEdit}
          style={{
            background: "none",
            border: `1px solid ${T.BORDER_SOFT}`,
            color: T.MUTED,
            fontSize: 11,
            fontWeight: 900,
            borderRadius: 6,
            padding: "4px 12px",
            cursor: "pointer",
            marginTop: 16,
          }}
        >
          Edit
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, opacity: saving ? 0.5 : 1, pointerEvents: saving ? "none" : "auto", transition: "opacity 120ms ease" }}>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 8 }}>CATEGORY</span>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {SOURCE_CATEGORIES.map((cat) => {
            const active = editCategory === cat
            const s = SOURCE_STYLE[cat]
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setEditCategory(cat)}
                style={{
                  fontSize: 11,
                  fontWeight: 900,
                  padding: "6px 12px",
                  borderRadius: 8,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  border: active ? `1px solid ${s.border}` : `1px solid ${T.BORDER_SOFT}`,
                  background: active ? s.bg : "rgba(255,255,255,0.04)",
                  color: active ? s.color : T.DIM,
                  fontFamily: "inherit",
                }}
              >
                {SOURCE_LABEL[cat]}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>DETAIL</span>
        <textarea
          style={{ ...textarea, minHeight: 60 }}
          value={editDetail}
          onChange={(e) => setEditDetail(e.target.value)}
          placeholder="e.g. Met at conference, intro from Sarah"
          maxLength={500}
        />
      </div>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>INVITED EMAIL</span>
        <input
          type="email"
          style={input}
          value={editEmail}
          onChange={(e) => setEditEmail(e.target.value)}
          placeholder="prospect@example.com"
        />
      </div>
      <div>
        <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6 }}>PHONE</span>
        <input
          type="tel"
          style={input}
          value={editPhone}
          onChange={(e) => setEditPhone(e.target.value)}
          placeholder="(555) 555-5555"
        />
      </div>
      {error && (
        <div style={{ padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{error}</span>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            ...btnPrimary,
            fontSize: 12,
            padding: "8px 16px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            opacity: saving ? 0.5 : 1,
          }}
        >
          {saving && <SavingSpinner size={10} />}
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={cancelEdit} disabled={saving} style={{ ...btnSecondary, fontSize: 12, padding: "8px 14px" }}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── Notes section ──

// TypeChipPicker / PriorityChipPicker — small reusable inline pickers
// used by both the Add and Edit forms.

function TypeChipPicker({
  value,
  onChange,
  size = "md",
}: {
  value: NoteType
  onChange: (next: NoteType) => void
  size?: "sm" | "md"
}) {
  const fontSize = size === "sm" ? 10 : 11
  const padding = size === "sm" ? "4px 10px" : "6px 12px"
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {NOTE_TYPES.map((t) => {
        const active = value === t
        return (
          <button
            key={t}
            type="button"
            onClick={() => onChange(t)}
            style={{
              fontSize,
              fontWeight: 900,
              padding,
              borderRadius: 8,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              border: active ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
              background: active ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
              color: active ? T.WRN_ORANGE : T.DIM,
              fontFamily: "inherit",
            }}
          >
            {NOTE_TYPE_LABEL[t]}
          </button>
        )
      })}
    </div>
  )
}

function PriorityChipPicker({
  value,
  onChange,
  size = "md",
}: {
  value: NotePriority
  onChange: (next: NotePriority) => void
  size?: "sm" | "md"
}) {
  const fontSize = size === "sm" ? 10 : 11
  const padding = size === "sm" ? "4px 10px" : "6px 12px"
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {NOTE_PRIORITIES.map((p) => {
        const active = value === p
        const s = NOTE_PRIORITY_BADGE[p]
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            style={{
              fontSize,
              fontWeight: 900,
              padding,
              borderRadius: 8,
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: 0.6,
              border: active ? `1px solid ${s.border}` : `1px solid ${T.BORDER_SOFT}`,
              background: active ? s.bg : "rgba(255,255,255,0.04)",
              color: active ? s.color : T.DIM,
              fontFamily: "inherit",
            }}
          >
            {NOTE_PRIORITY_LABEL[p]}
          </button>
        )
      })}
    </div>
  )
}

function ProspectNotesSection({
  prospectId,
  notes,
  onChanged,
}: {
  prospectId: string
  notes: ProspectNote[]
  onChanged: () => void
}) {
  // Local filter (matches NotesTab pattern — no URL sync).
  const [filter, setFilter] = useState<"" | NoteType>("")

  // Add form state.
  const [adding, setAdding] = useState(false)
  const [draftBody, setDraftBody] = useState("")
  const [draftType, setDraftType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [draftPriority, setDraftPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingAdd, setSavingAdd] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Edit form state.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState("")
  const [editType, setEditType] = useState<NoteType>(DEFAULT_NOTE_TYPE)
  const [editPriority, setEditPriority] = useState<NotePriority>(DEFAULT_ACTION_ITEM_PRIORITY)
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // Per-note busy state for inline operations (complete / delete).
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  // In-memory filter — notes come from the parent via GET detail,
  // and the parent re-fetches via onChanged() after each mutation.
  const filteredNotes = filter ? notes.filter((n) => n.type === filter) : notes

  function startAdd() {
    setAdding(true)
    setDraftBody("")
    setDraftType(DEFAULT_NOTE_TYPE)
    setDraftPriority(DEFAULT_ACTION_ITEM_PRIORITY)
    setAddError(null)
  }

  function cancelAdd() {
    setAdding(false)
    setDraftBody("")
    setAddError(null)
  }

  async function handleAdd() {
    const trimmed = draftBody.trim()
    if (!trimmed) {
      setAddError("Note can't be empty")
      return
    }
    setSavingAdd(true)
    setAddError(null)
    try {
      const body: Record<string, string> = {
        body: trimmed,
        type: draftType,
      }
      if (draftType === "action_item") body.priority = draftPriority
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes`, {
        method: "POST",
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 201 || j?.ok) {
        cancelAdd()
        onChanged()
      } else {
        setAddError(j?.error || "Couldn't save note — try again")
      }
    } catch {
      setAddError("Network error — try again")
    } finally {
      setSavingAdd(false)
    }
  }

  function startEdit(n: ProspectNote) {
    setEditingId(n.id)
    setEditBody(n.body)
    setEditType(n.type)
    setEditPriority((n.priority ?? DEFAULT_ACTION_ITEM_PRIORITY))
    setEditError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditBody("")
    setEditError(null)
  }

  async function saveEdit(noteId: string) {
    const trimmed = editBody.trim()
    if (!trimmed) {
      setEditError("Note can't be empty")
      return
    }
    setSavingEdit(true)
    setEditError(null)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${noteId}`, {
        method: "PUT",
        body: JSON.stringify({
          body: trimmed,
          type: editType,
          priority: editType === "action_item" ? editPriority : null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        cancelEdit()
        onChanged()
      } else {
        setEditError(j?.error || "Couldn't save note — try again")
      }
    } catch {
      setEditError("Network error — try again")
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleCompletion(n: ProspectNote) {
    if (n.type !== "action_item") return
    setBusyNoteId(n.id)
    setRowError(null)
    const next = n.completed_at ? null : new Date().toISOString()
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${n.id}`, {
        method: "PUT",
        body: JSON.stringify({ completed_at: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        onChanged()
      } else {
        setRowError(j?.error || "Couldn't update completion")
      }
    } catch {
      setRowError("Network error")
    } finally {
      setBusyNoteId(null)
    }
  }

  async function handleDelete(noteId: string) {
    if (!confirm("Delete this note?")) return
    setBusyNoteId(noteId)
    setRowError(null)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospectId}/notes/${noteId}`, {
        method: "DELETE",
      })
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) {
        onChanged()
      } else {
        setRowError(j?.error || "Couldn't delete note")
      }
    } catch {
      setRowError("Network error")
    } finally {
      setBusyNoteId(null)
    }
  }

  const headerRight = !adding ? (
    <button
      onClick={startAdd}
      style={{
        ...btnSecondary,
        fontSize: 12,
        fontWeight: 700,
        padding: "6px 12px",
        borderRadius: 8,
        color: T.WRN_ORANGE,
        borderColor: "rgba(254,176,106,0.3)",
      }}
    >
      + Add note
    </button>
  ) : null

  return (
    <Section title="Notes" count={notes.length > 0 ? `(${notes.length})` : undefined} headerRight={headerRight}>
      {/* Filter chip bar */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: adding || notes.length > 0 ? 16 : 0 }}>
        {NOTE_FILTER_OPTIONS.map((f) => {
          const active = filter === f.value
          return (
            <button
              key={f.value || "all"}
              onClick={() => setFilter(f.value)}
              style={{
                fontSize: 11,
                fontWeight: 900,
                padding: "6px 14px",
                borderRadius: 8,
                cursor: "pointer",
                textTransform: "uppercase",
                letterSpacing: 0.6,
                border: active ? `1px solid rgba(254,176,106,0.4)` : `1px solid ${T.BORDER_SOFT}`,
                background: active ? "rgba(254,176,106,0.1)" : "rgba(255,255,255,0.04)",
                color: active ? T.WRN_ORANGE : T.DIM,
                fontFamily: "inherit",
              }}
            >
              {f.label}
            </button>
          )
        })}
      </div>

      {/* Inline Add form */}
      {adding && (
        <div
          style={{
            marginBottom: 16,
            padding: 14,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid ${T.BORDER_SOFT}`,
            borderRadius: 10,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            opacity: savingAdd ? 0.5 : 1,
            pointerEvents: savingAdd ? "none" : "auto",
            transition: "opacity 120ms ease",
          }}
        >
          <div>
            <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6, fontSize: 9 }}>TYPE</span>
            <TypeChipPicker value={draftType} onChange={setDraftType} />
          </div>
          {draftType === "action_item" && (
            <div>
              <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 6, fontSize: 9 }}>PRIORITY</span>
              <PriorityChipPicker value={draftPriority} onChange={setDraftPriority} />
            </div>
          )}
          <textarea
            style={{ ...textarea, minHeight: 80, fontSize: 13 }}
            placeholder="What did you want to capture?"
            value={draftBody}
            onChange={(e) => { setDraftBody(e.target.value); if (addError) setAddError(null) }}
            autoFocus
          />
          {addError && (
            <div style={{ padding: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
              <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{addError}</span>
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={handleAdd}
              disabled={savingAdd || draftBody.trim().length === 0}
              style={{
                ...btnPrimary,
                fontSize: 11,
                padding: "6px 14px",
                opacity: savingAdd || draftBody.trim().length === 0 ? 0.5 : 1,
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {savingAdd && <SavingSpinner size={10} />}
              {savingAdd ? "Saving..." : "Save"}
            </button>
            <button onClick={cancelAdd} disabled={savingAdd} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {rowError && (
        <div style={{ marginBottom: 12, padding: 10, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{rowError}</span>
        </div>
      )}

      {/* Notes list (filtered in-memory) */}
      {filteredNotes.length === 0 ? (
        <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
          {filter ? `No ${NOTE_TYPE_LABEL[filter as NoteType].toLowerCase()} notes` : "No notes yet"}
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filteredNotes.map((n) => {
            const isEditing = editingId === n.id
            const isActionItem = n.type === "action_item"
            const isCompleted = !!n.completed_at
            const typeBadge = NOTE_TYPE_BADGE[n.type]
            const priorityBadge = n.priority ? NOTE_PRIORITY_BADGE[n.priority] : null
            const created = n.created_at ? new Date(n.created_at) : null
            const createdLabel = created
              ? created.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: created.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
                  hour: "numeric",
                  minute: "2-digit",
                })
              : null
            const wasEdited = n.updated_at && n.created_at && n.updated_at !== n.created_at

            return (
              <div
                key={n.id}
                style={{
                  padding: 14,
                  background: "rgba(255,255,255,0.025)",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  borderRadius: 10,
                  opacity: isCompleted ? 0.6 : 1,
                }}
              >
                {/* Header row: completion checkbox (action_item only) + badges + date + edited marker */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                  {isActionItem && (
                    <input
                      type="checkbox"
                      checked={isCompleted}
                      disabled={busyNoteId === n.id}
                      onChange={() => toggleCompletion(n)}
                      style={{ accentColor: T.WRN_ORANGE, width: 16, height: 16, cursor: "pointer" }}
                      aria-label={isCompleted ? "Mark incomplete" : "Mark complete"}
                    />
                  )}
                  <span
                    style={{
                      background: typeBadge.bg,
                      color: typeBadge.color,
                      fontSize: 10,
                      fontWeight: 900,
                      letterSpacing: 0.8,
                      textTransform: "uppercase",
                      padding: "3px 10px",
                      borderRadius: 999,
                    }}
                  >
                    {NOTE_TYPE_LABEL[n.type]}
                  </span>
                  {isActionItem && priorityBadge && n.priority && (
                    <span
                      style={{
                        background: priorityBadge.bg,
                        color: priorityBadge.color,
                        fontSize: 10,
                        fontWeight: 900,
                        letterSpacing: 0.8,
                        textTransform: "uppercase",
                        padding: "3px 10px",
                        borderRadius: 999,
                      }}
                    >
                      {NOTE_PRIORITY_LABEL[n.priority]}
                    </span>
                  )}
                  {isCompleted && (
                    <span style={{ fontSize: 11, color: T.SUCCESS, fontWeight: 700 }}>
                      ✓ Completed {new Date(n.completed_at!).toLocaleDateString()}
                    </span>
                  )}
                  {createdLabel && (
                    <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                      {createdLabel}
                      {wasEdited ? " · edited" : ""}
                    </span>
                  )}
                </div>

                {isEditing ? (
                  <div style={{ opacity: savingEdit ? 0.5 : 1, pointerEvents: savingEdit ? "none" : "auto", transition: "opacity 120ms ease" }}>
                    <div style={{ marginBottom: 10 }}>
                      <TypeChipPicker value={editType} onChange={setEditType} size="sm" />
                    </div>
                    {editType === "action_item" && (
                      <div style={{ marginBottom: 10 }}>
                        <PriorityChipPicker value={editPriority} onChange={setEditPriority} size="sm" />
                      </div>
                    )}
                    <textarea
                      style={{ ...textarea, minHeight: 100, fontSize: 13 }}
                      value={editBody}
                      onChange={(e) => { setEditBody(e.target.value); if (editError) setEditError(null) }}
                    />
                    {editError && (
                      <div style={{ padding: 8, marginTop: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)", borderRadius: 8 }}>
                        <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{editError}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button
                        onClick={() => saveEdit(n.id)}
                        disabled={savingEdit || editBody.trim().length === 0}
                        style={{
                          ...btnPrimary,
                          fontSize: 11,
                          padding: "6px 14px",
                          opacity: savingEdit || editBody.trim().length === 0 ? 0.5 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {savingEdit && <SavingSpinner size={10} />}
                        {savingEdit ? "Saving..." : "Save"}
                      </button>
                      <button onClick={cancelEdit} disabled={savingEdit} style={{ ...btnSecondary, fontSize: 11, padding: "6px 12px" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p
                      style={{
                        fontSize: 13,
                        color: T.TEXT,
                        lineHeight: "20px",
                        whiteSpace: "pre-wrap",
                        margin: 0,
                        textDecoration: isCompleted ? "line-through" : "none",
                      }}
                    >
                      {n.body}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <button
                        onClick={() => startEdit(n)}
                        style={{
                          background: "none",
                          border: `1px solid ${T.BORDER_SOFT}`,
                          color: T.MUTED,
                          fontSize: 11,
                          fontWeight: 900,
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(n.id)}
                        disabled={busyNoteId === n.id}
                        style={{
                          background: "none",
                          border: `1px solid ${T.BORDER_SOFT}`,
                          color: T.DIM,
                          fontSize: 11,
                          fontWeight: 900,
                          borderRadius: 6,
                          padding: "4px 12px",
                          cursor: "pointer",
                          opacity: busyNoteId === n.id ? 0.5 : 1,
                        }}
                      >
                        {busyNoteId === n.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ── Page ──

export default function ProspectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string

  const hasLoadedOnceRef = useRef(false)
  const [prospect, setProspect] = useState<Prospect | null>(null)
  const [pipeline, setPipeline] = useState<PipelineStage[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [accessDenied, setAccessDenied] = useState(false)
  const [stageError, setStageError] = useState<string | null>(null)
  const [stageBusyKey, setStageBusyKey] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [converting, setConverting] = useState(false)
  const [archiveHover, setArchiveHover] = useState(false)

  // Name edit (header strip click-to-edit, mirrors SourceSection pattern).
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState("")
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      const silent = opts?.silent === true || hasLoadedOnceRef.current
      hasLoadedOnceRef.current = true
      if (!silent) setLoading(true)
      const res = await authFetch(`/api/coach/prospects/${id}`)
      if (res.status === 403) {
        setAccessDenied(true)
        if (!silent) setLoading(false)
        return
      }
      if (res.ok) {
        const j = await res.json()
        setProspect(j.prospect)
      }
      if (!silent) setLoading(false)
    },
    [id],
  )

  useEffect(() => { load() }, [load])

  // Load the coach's pipeline once (coach-level, stable across this prospect).
  // Drives the stage tracker; GET lazy-seeds for a brand-new coach.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch("/api/coach/pipeline")
        if (!res.ok) return
        const j = await res.json()
        if (!cancelled && j?.ok) setPipeline((j.stages || []) as PipelineStage[])
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  // Redirect-away for any non-Prospect lifecycle. The prospect detail
  // page only handles State A (lifecycle='Prospect') in 4c; the
  // post-conversion surface (Active without client_profile_id, or
  // anything else) belongs on /dashboard/coach/coach-clients/[id],
  // shipping in 4d. Pre-4d, that route 404s — accepted intentionally.
  useEffect(() => {
    if (prospect && prospect.lifecycle_status !== "Prospect") {
      router.replace(`/dashboard/coach/coach-clients/${prospect.id}`)
    }
  }, [prospect, router])

  // ── Stage advance (fill the path) ──
  // Clicking a stage advances TO it: every active non-terminal stage up to and
  // including the target that isn't yet reached is marked, ascending, via the
  // per-click stage PATCH (matches v0.1's per-click pattern). The step-3 handler
  // recomputes current_stage_key = furthest reached on each call. We reload at
  // the end to pick up reached_at + current_stage_key.
  //
  // BACKWARD MOVES: under the furthest-reached model, clicking an already-reached
  // stage is a no-op — reached is monotonic and the pointer stays at the furthest
  // reached stage (reached buttons are disabled). True regression (un-reaching a
  // later stage) is not supported by the stage API and is intentionally out of
  // scope here.
  async function advanceTo(stageKey: string) {
    if (!prospect || !pipeline) return
    const target = pipeline.find((s) => s.stage_key === stageKey)
    if (!target || target.is_terminal) return
    const reached = new Set(prospect.stage_progress.map((p) => p.stage_key))
    const toMark = pipeline
      .filter((s) => s.active && !s.is_terminal && s.sort_order <= target.sort_order && !reached.has(s.stage_key))
      .sort((a, b) => a.sort_order - b.sort_order)
    if (toMark.length === 0) return
    setStageBusyKey(stageKey)
    setStageError(null)
    try {
      for (const s of toMark) {
        const res = await authFetch(`/api/coach/prospects/${prospect.id}/stage`, {
          method: "PATCH",
          body: JSON.stringify({ stage_key: s.stage_key }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setStageError(j?.error || "Couldn't advance — try again")
          setTimeout(() => setStageError(null), 4000)
          break
        }
      }
      await load({ silent: true })
    } catch {
      setStageError("Network error — try again")
      setTimeout(() => setStageError(null), 4000)
    } finally {
      setStageBusyKey(null)
    }
  }

  // ── Convert (terminal stage; button-with-confirmation) ──
  // Single convert path: PATCH .../stage with the terminal stage_key. The step-3
  // handler fires the existing conversion (lifecycle → Active) AND sets
  // prospect_status = won, returning redirect_to. We use that to do the same
  // post-convert redirect the old standalone "Convert to Active" button did
  // (that button is removed — see header — to avoid two convert paths; the old
  // one bypassed prospect_status=won).
  async function convertViaStage() {
    if (!prospect || !pipeline) return
    const terminal = pipeline.find((s) => s.is_terminal)
    if (!terminal) {
      setStageError("No Convert stage configured")
      return
    }
    if (!confirm(`Convert ${prospect.name || "this prospect"} to a client? This creates their client account and can't be undone.`)) return
    setConverting(true)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}/stage`, {
        method: "PATCH",
        body: JSON.stringify({ stage_key: terminal.stage_key }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(j?.error || "Couldn't convert — try again")
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 600))
      router.push(j?.redirect_to || `/dashboard/coach/coach-clients/${prospect.id}`)
    } catch {
      alert("Network error — try again")
    } finally {
      setConverting(false)
    }
  }

  // ── Prospect status (Active / Inactive / Lost) ──
  async function setProspectStatus(next: ProspectStatus) {
    if (!prospect) return
    setStatusBusy(true)
    setStageError(null)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ prospect_status: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setStageError(j?.error || "Couldn't update status — try again")
        setTimeout(() => setStageError(null), 4000)
        return
      }
      setProspect((p) => (p ? { ...p, prospect_status: next } : p))
    } catch {
      setStageError("Network error — try again")
      setTimeout(() => setStageError(null), 4000)
    } finally {
      setStatusBusy(false)
    }
  }

  async function handleSourceUpdate(
    updates: { name?: string; source_category?: SourceCategory; source_detail?: string | null; invited_email?: string | null; phone?: string | null },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!prospect) return { ok: false, error: "No prospect loaded" }
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}`, {
        method: "PATCH",
        body: JSON.stringify(updates),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        return { ok: false, error: j?.error || "Couldn't save — try again" }
      }
      if (j?.prospect) {
        setProspect({ ...j.prospect, notes: j.prospect.notes ?? prospect.notes })
      }
      return { ok: true }
    } catch {
      return { ok: false, error: "Network error — try again" }
    }
  }

  // Save edited name (header strip click-to-edit). PATCHes the same
  // /api/coach/prospects/[id] endpoint via the shared handleSourceUpdate
  // wrapper. Server enforces the 1-200 char + trimmed non-empty rules.
  async function saveName() {
    if (!prospect) return
    const trimmed = draftName.trim()
    if (!trimmed) {
      setNameError("Name cannot be empty")
      return
    }
    if (trimmed === (prospect.name ?? "")) {
      setEditingName(false)
      return
    }
    setSavingName(true)
    setNameError(null)
    const res = await handleSourceUpdate({ name: trimmed })
    setSavingName(false)
    if (!res.ok) {
      setNameError(res.error)
      return
    }
    setEditingName(false)
  }

  function startNameEdit() {
    if (!prospect) return
    setDraftName(prospect.name || "")
    setNameError(null)
    setEditingName(true)
  }

  function cancelNameEdit() {
    setEditingName(false)
    setNameError(null)
  }

  // Archive (soft-revoke, with confirm()).
  async function handleArchive() {
    if (!prospect) return
    const name = prospect.name || "this prospect"
    if (!confirm(`Archive ${name}? This can be undone.`)) return
    setArchiving(true)
    try {
      const res = await authFetch(`/api/coach/prospects/${prospect.id}`, { method: "DELETE" })
      if (res.ok) {
        router.push("/dashboard/coach/prospects")
        return
      }
      const j = await res.json().catch(() => ({}))
      alert(j?.error || "Couldn't archive — try again")
    } catch {
      alert("Network error — try again")
    } finally {
      setArchiving(false)
    }
  }

  if (loading) return <LoadingShell />

  if (accessDenied) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    )
  }

  if (!prospect) return null

  // Single guard: any non-Prospect lifecycle renders the redirect
  // shell while the useEffect above does router.replace().
  if (prospect.lifecycle_status !== "Prospect") {
    return <LoadingShell label="Redirecting..." />
  }

  // Active stages in order for the tracker; reached map from progress rows.
  const activeStages = (pipeline ?? []).filter((s) => s.active).sort((a, b) => a.sort_order - b.sort_order)
  const reachedMap: Record<string, string | null> = {}
  for (const p of prospect.stage_progress) reachedMap[p.stage_key] = p.reached_at

  return (
    <div>
      <a
        href="/dashboard/coach/prospects"
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#2CA58D",
          textDecoration: "none",
          display: "inline-block",
          marginBottom: 18,
          letterSpacing: 0.2,
        }}
      >
        ← Back to Prospects
      </a>

      {/* Header strip */}
      <div style={{ ...card, padding: 24, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {editingName ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", minWidth: 240 }}>
              <input
                type="text"
                style={{ ...input, height: 40, fontSize: 18, fontWeight: 500, flex: 1, maxWidth: 400 }}
                value={draftName}
                onChange={(e) => { setDraftName(e.target.value); if (nameError) setNameError(null) }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveName() }
                  if (e.key === "Escape") { e.preventDefault(); cancelNameEdit() }
                }}
                autoFocus
                disabled={savingName}
                maxLength={200}
              />
              <button
                onClick={saveName}
                disabled={savingName}
                style={{
                  ...btnPrimary,
                  fontSize: 12,
                  padding: "8px 14px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: savingName ? 0.5 : 1,
                }}
              >
                {savingName && <SavingSpinner size={10} />}
                {savingName ? "Saving..." : "Save"}
              </button>
              <button
                onClick={cancelNameEdit}
                disabled={savingName}
                style={{ ...btnSecondary, fontSize: 12, padding: "8px 12px" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
                {prospect.name || "Unnamed prospect"}
              </h1>
              <button
                onClick={startNameEdit}
                style={{
                  background: "none",
                  border: `1px solid ${T.BORDER_SOFT}`,
                  color: T.MUTED,
                  fontSize: 11,
                  fontWeight: 900,
                  borderRadius: 6,
                  padding: "4px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Edit
              </button>
            </>
          )}
          {/* Static record-type label — quiet (states what this record IS).
              Differentiated in KIND from the interactive status control beside
              it: muted, outlined, not a colored fill. */}
          <span
            style={{
              background: T.GLASS,
              color: T.MUTED,
              border: `1px solid ${T.BORDER_SOFT}`,
              fontSize: 11,
              fontWeight: 800,
              padding: "5px 12px",
              borderRadius: 8,
              whiteSpace: "nowrap",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              display: "inline-block",
            }}
          >
            Prospect
          </span>

          {/* Interactive status control — visually separated from the static
              label (left divider + "STATUS" caption) so the two don't read as
              one set. Active/Inactive/Lost; Won is automatic on convert (§4). */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginLeft: 4,
              paddingLeft: 16,
              borderLeft: `1px solid ${T.BORDER_SOFT}`,
            }}
          >
            <span style={{ ...eyebrow, fontSize: 9, color: T.DIM }}>STATUS</span>
            <ProspectStatusControl status={prospect.prospect_status} busy={statusBusy} onSet={setProspectStatus} />
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* The standalone "Convert to Active" button is removed — conversion
                now happens via the stage tracker's terminal Convert button
                (single convert path; also sets prospect_status=won). */}
            <button
              onClick={handleArchive}
              onMouseEnter={() => setArchiveHover(true)}
              onMouseLeave={() => setArchiveHover(false)}
              disabled={archiving}
              style={{
                ...btnSecondary,
                fontSize: 12,
                padding: "8px 14px",
                background: archiveHover ? "rgba(255,120,120,0.08)" : T.CARD,
                border: archiveHover ? "1px solid rgba(255,120,120,0.3)" : `1px solid ${T.BORDER_SOFT}`,
                color: archiveHover ? T.TEXT : T.DIM,
                cursor: "pointer",
                transition: "all 120ms ease",
                opacity: archiving ? 0.5 : 1,
              }}
            >
              {archiving ? "Archiving..." : "Archive"}
            </button>
          </div>
        </div>
      </div>

      {/* Name save error (inline below the header, parallel to stageError) */}
      {nameError && (
        <div
          style={{
            padding: 10,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{nameError}</span>
        </div>
      )}

      {/* Transient stage/status save error banner */}
      {stageError && (
        <div
          style={{
            padding: 10,
            background: "rgba(248,113,113,0.1)",
            border: "1px solid rgba(248,113,113,0.3)",
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <span style={{ fontSize: 12, color: "#f87171", fontWeight: 700 }}>{stageError}</span>
        </div>
      )}

      <Section title="Prospect Information">
        <SourceSection
          category={prospect.source_category}
          detail={prospect.source_detail}
          invitedEmail={prospect.invited_email}
          phone={prospect.phone}
          createdAt={prospect.created_at}
          lastActivityAt={prospect.last_activity_at}
          onSave={handleSourceUpdate}
        />
      </Section>

      <Section title="Pipeline">
        {pipeline === null ? (
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading pipeline…</p>
        ) : activeStages.length === 0 ? (
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>No pipeline stages configured.</p>
        ) : (
          <StageTracker
            stages={activeStages}
            reachedMap={reachedMap}
            currentStageKey={prospect.current_stage_key}
            busyKey={stageBusyKey}
            converting={converting}
            onAdvance={advanceTo}
            onConvert={convertViaStage}
          />
        )}
      </Section>

      <ProspectNotesSection
        prospectId={prospect.id}
        notes={prospect.notes}
        onChanged={() => load({ silent: true })}
      />
    </div>
  )
}
