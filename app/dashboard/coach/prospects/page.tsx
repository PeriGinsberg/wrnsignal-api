"use client"

// Prospects list page (Prospects v0.1 Commit 4c).
// Renders /api/coach/prospects GET response. Sort is server-side
// (last_activity_at DESC NULLS LAST, then created_at DESC).
//
// Row shape:
//   Avatar | name | SourceCategoryBadge | current stage label | status pill |
//   invited_email | timeAgo(last_activity_at) | Open →
//
// "+ Add Prospect" button in header opens AddProspectModal.
// On success, modal closes + list reloads.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { T, btnSecondary, card, eyebrow } from "../../../../lib/dashboard-theme"
import { BackToDashboard } from "../BackToDashboard"
import { LoadingShell } from "../LoadingShell"
import {
  onCoachRowEnter,
  onCoachRowLeave,
  COACH_ROW_DEFAULT_BG,
  COACH_ROW_TRANSITION,
} from "../coachRowHover"
import AddProspectModal from "./AddProspectModal"

// ── Constants (duplicated per inline pattern) ──

// Prospect sub-status pill (matches the detail page treatment). 'won' is
// included for completeness, though won prospects convert to Active lifecycle
// and leave this list (filtered lifecycle=Prospect). A NULL prospect_status is
// treated as the implicit "active" default (the create path doesn't set it).
type ProspectStatus = "active" | "inactive" | "lost" | "won"
const PROSPECT_STATUS_LABEL: Record<ProspectStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  lost: "Lost",
  won: "Won",
}
// Selected colors kept in sync with the detail page (prospects/[id]/page.tsx):
// Active green, Inactive amber "on hold", Lost red, Won teal.
const PROSPECT_STATUS_STYLE: Record<ProspectStatus, { bg: string; color: string; border: string }> = {
  active:   { bg: "rgba(74,222,128,0.18)",  color: "#4ade80", border: "rgba(74,222,128,0.50)" },
  inactive: { bg: "rgba(254,176,106,0.18)", color: "#FEB06A", border: "rgba(254,176,106,0.50)" },
  lost:     { bg: "rgba(248,113,113,0.20)", color: "#f87171", border: "rgba(248,113,113,0.55)" },
  won:      { bg: "rgba(45,165,141,0.18)",  color: "#2CA58D", border: "rgba(45,165,141,0.45)" },
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

const SOURCE_STYLE: Record<SourceCategory, { bg: string; color: string }> = {
  referral:         { bg: "rgba(81,173,229,0.12)",  color: "#51ADE5" },
  social_media:     { bg: "rgba(167,139,250,0.18)", color: "#C8B6F8" },
  website:          { bg: "rgba(45,165,141,0.15)",  color: "#2CA58D" },
  personal_contact: { bg: "rgba(74,222,128,0.15)",  color: "#4ade80" },
  other:            { bg: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.60)" },
}

const AVATAR_PALETTE = [
  { bg: "rgba(81,173,229,0.18)",  text: "#9FC9EE" },
  { bg: "rgba(254,176,106,0.18)", text: "#FECDA0" },
  { bg: "rgba(167,139,250,0.18)", text: "#C8B6F8" },
  { bg: "rgba(244,114,182,0.18)", text: "#F4ADC9" },
  { bg: "rgba(74,222,128,0.18)",  text: "#9CE7B5" },
] as const

// ── Types ──

type Prospect = {
  id: string
  name: string | null
  invited_email: string | null
  source_category: SourceCategory | null
  source_detail: string | null
  lifecycle_status: string
  current_stage_key: string | null
  prospect_status: ProspectStatus | null
  last_activity_at: string | null
  created_at: string | null
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

function hashIndex(s: string, mod: number): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i)
  return Math.abs(h) % mod
}

function initialsOf(name: string | null, fallback: string | null): string {
  const src = (name && name.trim()) || (fallback && fallback.trim()) || "?"
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

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

// ── Inline atoms ──

function Avatar({ name, email }: { name: string | null; email: string | null }) {
  const seed = (name || email || "?").toLowerCase()
  const palette = AVATAR_PALETTE[hashIndex(seed, AVATAR_PALETTE.length)]
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: palette.bg,
        color: palette.text,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 900,
        letterSpacing: 0.3,
        flexShrink: 0,
      }}
    >
      {initialsOf(name, email)}
    </div>
  )
}

function SourceCategoryBadge({ category }: { category: SourceCategory | null }) {
  if (!category) return null
  const s = SOURCE_STYLE[category]
  return (
    <span
      style={{
        background: s.bg,
        color: s.color,
        fontSize: 9,
        fontWeight: 900,
        letterSpacing: 1,
        textTransform: "uppercase",
        padding: "3px 8px",
        borderRadius: 6,
        whiteSpace: "nowrap",
      }}
    >
      {SOURCE_LABEL[category]}
    </span>
  )
}

// Current stage label, resolved from the coach's pipeline (key→label map built
// once on the page). "Not started" when no stage has been reached yet.
function StageLabel({ stageKey, labelByKey }: { stageKey: string | null; labelByKey: Record<string, string> }) {
  const text = (stageKey && labelByKey[stageKey]) || "Not started"
  const started = !!stageKey && !!labelByKey[stageKey]
  return (
    <span style={{ fontSize: 12, color: started ? T.TEXT : T.DIM, fontWeight: started ? 700 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
      {text}
    </span>
  )
}

// Read-only prospect-status pill (matches the detail page treatment). NULL is
// shown as the implicit "Active" default.
function StatusPill({ status }: { status: ProspectStatus | null }) {
  const s: ProspectStatus = status ?? "active"
  const st = PROSPECT_STATUS_STYLE[s]
  return (
    <span
      style={{
        background: st.bg,
        color: st.color,
        border: `1px solid ${st.border}`,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.3,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {PROSPECT_STATUS_LABEL[s]}
    </span>
  )
}

function ProspectRow({
  prospect,
  labelByKey,
  onOpen,
}: {
  prospect: Prospect
  labelByKey: Record<string, string>
  onOpen: () => void
}) {
  return (
    <div
      onClick={onOpen}
      onMouseEnter={onCoachRowEnter}
      onMouseLeave={(e) => onCoachRowLeave(e)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "12px 14px",
        background: COACH_ROW_DEFAULT_BG,
        border: `1px solid ${T.BORDER_SOFT}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: COACH_ROW_TRANSITION,
      }}
    >
      <Avatar name={prospect.name} email={prospect.invited_email} />

      <div style={{ minWidth: 0, flex: "1 1 200px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: T.TEXT,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 200,
            }}
          >
            {prospect.name || "Unnamed"}
          </span>
          <SourceCategoryBadge category={prospect.source_category} />
        </div>
      </div>

      {/* Current stage label + status pill (replaces the old N/7 phases chip) */}
      <div style={{ flexShrink: 0, minWidth: 140, maxWidth: 180 }}>
        <StageLabel stageKey={prospect.current_stage_key} labelByKey={labelByKey} />
      </div>

      <div style={{ flexShrink: 0, minWidth: 84 }}>
        <StatusPill status={prospect.prospect_status} />
      </div>

      <div style={{ flexShrink: 0, minWidth: 160, fontSize: 12, color: T.DIM, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {prospect.invited_email || ""}
      </div>

      <div style={{ flexShrink: 0, minWidth: 90, textAlign: "right", fontSize: 11, color: T.DIM }}>
        {timeAgo(prospect.last_activity_at)}
      </div>

      <button
        onClick={(e) => { e.stopPropagation(); onOpen() }}
        style={{
          ...btnSecondary,
          fontSize: 12,
          fontWeight: 700,
          padding: "7px 14px",
          borderRadius: 8,
          color: T.WRN_ORANGE,
          borderColor: "rgba(254,176,106,0.3)",
          flexShrink: 0,
        }}
      >
        Open →
      </button>
    </div>
  )
}

// ── Page ──

export default function ProspectsListPage() {
  const router = useRouter()
  const [prospects, setProspects] = useState<Prospect[] | null>(null)
  // Coach pipeline stage_key → label map, fetched ONCE for the page (not per
  // row), so list rows can resolve current_stage_key to a human label.
  const [labelByKey, setLabelByKey] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const hasLoadedOnceRef = useRef(false)

  const load = useCallback(async () => {
    const silent = hasLoadedOnceRef.current
    hasLoadedOnceRef.current = true
    if (!silent) setLoading(true)
    const res = await authFetch("/api/coach/prospects")
    if (res.status === 403) {
      setForbidden(true)
      if (!silent) setLoading(false)
      return
    }
    if (res.ok) {
      const j = await res.json()
      setProspects(j.prospects || [])
    }
    if (!silent) setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Fetch the coach's pipeline once; build a stage_key → label map for the rows.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await authFetch("/api/coach/pipeline")
        if (!res.ok) return
        const j = await res.json()
        if (cancelled || !j?.ok) return
        const map: Record<string, string> = {}
        for (const s of (j.stages || []) as Array<{ stage_key: string; label: string }>) {
          map[s.stage_key] = s.label
        }
        setLabelByKey(map)
      } catch {}
    })()
    return () => { cancelled = true }
  }, [])

  // Server sort is authoritative; no client re-sort.
  const list = useMemo(() => prospects || [], [prospects])

  if (loading) return <LoadingShell />

  if (forbidden) {
    return (
      <div style={{ ...card, padding: 40, maxWidth: 480, textAlign: "center" }}>
        <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 12 }}>ACCESS DENIED</div>
        <p style={{ color: T.TEXT, fontSize: 15, fontWeight: 900 }}>Coach access required</p>
      </div>
    )
  }

  return (
    <div>
      <BackToDashboard />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 500, letterSpacing: -0.5, color: T.TEXT, margin: 0 }}>
            Prospects <span style={{ color: T.DIM, fontWeight: 400, fontSize: 18 }}>({list.length})</span>
          </h1>
          <p style={{ fontSize: 13, color: T.MUTED, marginTop: 8, maxWidth: 540 }}>
            Track potential clients through your sales pipeline. Convert them to Active when they sign on.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            background: T.WRN_ORANGE,
            color: "#04060F",
            borderRadius: 10,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 800,
            cursor: "pointer",
            border: "none",
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          + Add Prospect
        </button>
      </div>

      <div style={{ ...card, padding: 20 }}>
        {list.length === 0 ? (
          <p style={{ color: T.MUTED, fontSize: 13, margin: 0 }}>
            No prospects yet — click &ldquo;+ Add Prospect&rdquo; above to capture your first one.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {list.map((p) => (
              <ProspectRow
                key={p.id}
                prospect={p}
                labelByKey={labelByKey}
                onOpen={() => router.push(`/dashboard/coach/prospects/${p.id}`)}
              />
            ))}
          </div>
        )}
      </div>

      {showAdd && (
        <AddProspectModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); load() }}
        />
      )}
    </div>
  )
}
