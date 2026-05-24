"use client"

// Prospects list page (Prospects v0.1 Commit 4c).
// Renders /api/coach/prospects GET response. Sort is server-side
// (last_activity_at DESC NULLS LAST, then created_at DESC).
//
// Row shape:
//   Avatar | name | SourceCategoryBadge | "{n} / 7 phases" | invited_email | timeAgo(last_activity_at) | Open →
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

type PhasePair = { checked: boolean; at: string | null }

type Prospect = {
  id: string
  name: string | null
  invited_email: string | null
  source_category: SourceCategory | null
  source_detail: string | null
  phases: Record<PhaseKey, PhasePair>
  lifecycle_status: string
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

function countCheckedPhases(phases: Record<PhaseKey, PhasePair>): number {
  let n = 0
  for (const k of PHASE_KEYS) if (phases[k]?.checked) n++
  return n
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

function PhaseProgressChip({ phases }: { phases: Record<PhaseKey, PhasePair> }) {
  const n = countCheckedPhases(phases)
  const color = n > 0 ? T.WRN_BLUE : T.DIM
  return (
    <span style={{ fontSize: 11, color, fontWeight: 700, whiteSpace: "nowrap" }}>
      {n} / 7 phases
    </span>
  )
}

function ProspectRow({
  prospect,
  onOpen,
}: {
  prospect: Prospect
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

      <div style={{ flexShrink: 0, minWidth: 100 }}>
        <PhaseProgressChip phases={prospect.phases} />
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
