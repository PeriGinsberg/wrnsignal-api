"use client"

// Full Analysis — a read-only, newest-first list of the client's SIGNAL runs
// showing FULL jobfit and cover-letter content. Reads the existing gated coach
// endpoint:
//   GET /api/coach/client-runs/[client_profile_id]
//   → { ok, runs: [{ function_type, run_id, created_at, owner, display, notes }] }
// Access is enforced server-side by the shared lib/collab check ('view' level);
// this component adds NO access logic.
//
// Only 'jobfit' and 'coverletter' runs are rendered — positioning and networking
// are intentionally omitted for now (not finished). No pagination in this version.
//
// getToken/authFetch inlined per the coach-route client convention (same pair as
// HistoryTab / EngagementsTab / NotesTab).

import { useCallback, useEffect, useState } from "react"
import { T, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

type SignalRun = {
  function_type: string
  run_id: string
  created_at: string
  owner: "coach" | "client"
  display: Record<string, any>
  notes: any[]
}

// ── Auth (same inline pattern as HistoryTab) ──
async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
  })
}

// ── Small presentational helpers ──
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}

// Robust "pick the first array of the two" — mirrors the Source-a-Job renderer's
// (bullets || why) / (risk_flags || risk) fallbacks, but guards non-arrays.
function pickArray(a: unknown, b: unknown): any[] {
  if (Array.isArray(a)) return a
  if (Array.isArray(b)) return b
  return []
}

// Muted-vs-positive tint for the decision label, from pass/fail keywords.
function decisionTint(decision: string | null): { bg: string; color: string } {
  const d = (decision || "").toLowerCase()
  if (d.includes("pass")) return { bg: T.SUCCESS_BG, color: T.SUCCESS }
  if (d.includes("fail") || d.includes("no")) return { bg: T.ERROR_BG, color: T.ERROR }
  return { bg: T.WARNING_BG, color: T.WRN_ORANGE }
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
  textTransform: "uppercase", color: T.DIM, marginBottom: 6,
}
const cardStyle: React.CSSProperties = {
  borderRadius: 14, border: `1px solid ${T.BORDER_SOFT}`,
  background: T.CARD, padding: 16, marginBottom: 14,
}

function OwnerTag({ owner }: { owner: SignalRun["owner"] }) {
  const isCoach = owner === "coach"
  return (
    <span style={{
      fontSize: 10, fontWeight: 900, letterSpacing: 0.5, padding: "2px 8px",
      borderRadius: 999, border: `1px solid ${T.BORDER_SOFT}`,
      background: isCoach ? T.WARNING_BG : T.NAV_DEFAULT_BG,
      color: isCoach ? T.WRN_ORANGE : T.MUTED,
    }}>
      {isCoach ? "COACH-SOURCED" : "CLIENT"}
    </span>
  )
}

function BulletList({ items, color }: { items: any[]; color: string }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((b, i) => (
        <li key={i} style={{ fontSize: 13, color, lineHeight: "19px" }}>{String(b)}</li>
      ))}
    </ul>
  )
}

// ── Jobfit card: renders the full result_json (decision, score, why, risk, …) ──
function JobfitCard({ run }: { run: SignalRun }) {
  const d = run.display || {}
  const decision: string | null = typeof d.decision === "string" ? d.decision : null
  const score: number | null = typeof d.score === "number" ? d.score : null
  const js = (d.job_signals && typeof d.job_signals === "object") ? d.job_signals : {}
  const jobTitle = typeof js.jobTitle === "string" ? js.jobTitle : null
  const companyName = typeof js.companyName === "string" ? js.companyName : null
  const nextStep = typeof d.next_step === "string" ? d.next_step : null
  const why = pickArray(d.bullets, d.why).filter(Boolean)
  const risk = pickArray(d.risk_flags, d.risk).filter(Boolean)
  const tint = decisionTint(decision)

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, color: T.WRN_BLUE }}>JOBFIT</span>
        <OwnerTag owner={run.owner} />
        <span style={{ marginLeft: "auto", fontSize: 11, color: T.DIM }}>{fmtDate(run.created_at)}</span>
      </div>

      <div style={{ marginTop: 8, fontSize: 15, fontWeight: 800, color: T.TEXT }}>
        {jobTitle || "Untitled role"}{companyName ? <span style={{ color: T.MUTED, fontWeight: 600 }}> · {companyName}</span> : null}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
        {decision && (
          <span style={{ fontSize: 12, fontWeight: 900, padding: "3px 10px", borderRadius: 999, background: tint.bg, color: tint.color }}>
            {decision}
          </span>
        )}
        {score !== null && (
          <span style={{ fontSize: 13, color: T.DIM }}>Score: <span style={{ color: T.TEXT, fontWeight: 900 }}>{score}</span></span>
        )}
      </div>

      {why.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={sectionLabel}>Why it fits</div>
          <BulletList items={why} color={T.TEXT} />
        </div>
      )}

      {risk.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={sectionLabel}>Risks / watch-outs</div>
          <BulletList items={risk} color={T.MUTED} />
        </div>
      )}

      {nextStep && (
        <div style={{ marginTop: 12 }}>
          <div style={sectionLabel}>Next step</div>
          <div style={{ fontSize: 13, color: T.TEXT, lineHeight: "19px" }}>{nextStep}</div>
        </div>
      )}
    </div>
  )
}

// ── Cover-letter card: full letter body + contact (if present) ──
function CoverLetterCard({ run }: { run: SignalRun }) {
  const d = run.display || {}
  const letter = typeof d.letter === "string" ? d.letter : null
  const contact = d.contact
  const contactLines: [string, string][] =
    contact && typeof contact === "object"
      ? Object.entries(contact)
          .filter(([, v]) => v != null && String(v).trim() !== "")
          .map(([k, v]) => [k, String(v)] as [string, string])
      : []

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1.5, color: T.WRN_TEAL }}>COVER LETTER</span>
        <OwnerTag owner={run.owner} />
        <span style={{ marginLeft: "auto", fontSize: 11, color: T.DIM }}>{fmtDate(run.created_at)}</span>
      </div>

      {typeof contact === "string" && contact.trim() !== "" && (
        <div style={{ marginTop: 10, fontSize: 12, color: T.MUTED }}>{contact}</div>
      )}
      {contactLines.length > 0 && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "2px 16px" }}>
          {contactLines.map(([k, v]) => (
            <span key={k} style={{ fontSize: 12, color: T.MUTED }}>
              <span style={{ color: T.DIM }}>{k}:</span> {v}
            </span>
          ))}
        </div>
      )}

      {letter ? (
        <div style={{ marginTop: 12 }}>
          <div style={sectionLabel}>Letter</div>
          <div style={{ fontSize: 13, color: T.TEXT, lineHeight: "20px", whiteSpace: "pre-wrap" }}>{letter}</div>
        </div>
      ) : (
        <div style={{ marginTop: 12, fontSize: 13, color: T.DIM }}>No letter body on this run.</div>
      )}
    </div>
  )
}

export function FullAnalysisTab({ clientProfileId }: { clientProfileId: string | null }) {
  const [runs, setRuns] = useState<SignalRun[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!clientProfileId) { setLoading(false); setRuns([]); return }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch(`/api/coach/client-runs/${clientProfileId}`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load analysis (${res.status})`)
        return
      }
      const all: SignalRun[] = Array.isArray(j.runs) ? j.runs : []
      // Only jobfit + cover letter; positioning/networking omitted for now.
      const filtered = all.filter(
        (r) => r.function_type === "jobfit" || r.function_type === "coverletter",
      )
      // Newest first.
      filtered.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      setRuns(filtered)
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [clientProfileId])

  useEffect(() => { void load() }, [load])

  if (!clientProfileId) {
    return <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>No analysis yet.</p>
  }
  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading full analysis…</p>
  }
  if (loadError) {
    return (
      <div>
        <div style={{ fontSize: 12, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>
          {loadError}
        </div>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }
  if (runs.length === 0) {
    return <p style={{ fontSize: 13, color: T.DIM, margin: 0 }}>No jobfit or cover-letter runs yet.</p>
  }

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {runs.map((r) =>
        r.function_type === "jobfit"
          ? <JobfitCard key={`${r.function_type}:${r.run_id}`} run={r} />
          : <CoverLetterCard key={`${r.function_type}:${r.run_id}`} run={r} />,
      )}
    </div>
  )
}
