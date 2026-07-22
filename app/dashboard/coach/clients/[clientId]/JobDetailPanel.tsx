"use client"

// JobDetailPanel — one slide-in panel per job, opened from a Job Tracker row's
// "Full Jobfit" / "Cover Letter" link. Shows BOTH sections (collapsible); opens
// focused on whichever link was clicked. Loads full content lazily from the
// coach-gated per-job detail endpoint:
//   GET /api/coach/clients/[clientId]/applications/[applicationId]/detail
//   → { ok, jobfit: result_json|null, coverLetter: { letter, contact, ... }|null }
// Access is enforced server-side (application owner → shared lib/collab view
// check); this component adds no access logic. Sets up for coach notes: a
// per-(job, section) panel is the natural home for a notes thread later.
//
// getToken/authFetch inlined per the coach-route client convention.

import { useCallback, useEffect, useState } from "react"
import { T, btnSecondary, eyebrow } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

export type PanelSection = "jobfit" | "coverletter"

type Detail = { jobfit: any; coverLetter: any }

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } })
}

// ── render helpers (ported from the retired Full Analysis renderers) ──
function pickArray(a: unknown, b: unknown): any[] {
  if (Array.isArray(a)) return a
  if (Array.isArray(b)) return b
  return []
}
function decisionTint(decision: string | null): { bg: string; color: string } {
  const d = (decision || "").toLowerCase()
  if (d.includes("pass")) return { bg: T.SUCCESS_BG, color: T.SUCCESS }
  if (d.includes("fail") || d.includes("no")) return { bg: T.ERROR_BG, color: T.ERROR }
  return { bg: T.WARNING_BG, color: T.WRN_ORANGE }
}
const subLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 900, letterSpacing: 1.5,
  textTransform: "uppercase", color: T.DIM, marginBottom: 6,
}
function BulletList({ items, color }: { items: any[]; color: string }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((b, i) => <li key={i} style={{ fontSize: 13, color, lineHeight: "19px" }}>{String(b)}</li>)}
    </ul>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 13, color: T.DIM }}>{children}</div>
}

function JobfitSection({ jobfit }: { jobfit: any }) {
  if (!jobfit || typeof jobfit !== "object") return <Empty>No jobfit content on this job.</Empty>
  const d = jobfit
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
    <div>
      {(jobTitle || companyName) && (
        <div style={{ fontSize: 14, fontWeight: 800, color: T.TEXT, marginBottom: 8 }}>
          {jobTitle || "Untitled role"}{companyName ? <span style={{ color: T.MUTED, fontWeight: 600 }}> · {companyName}</span> : null}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {decision && <span style={{ fontSize: 12, fontWeight: 900, padding: "3px 10px", borderRadius: 999, background: tint.bg, color: tint.color }}>{decision}</span>}
        {score !== null && <span style={{ fontSize: 13, color: T.DIM }}>Score: <span style={{ color: T.TEXT, fontWeight: 900 }}>{score}</span></span>}
      </div>
      {why.length > 0 && (
        <div style={{ marginBottom: 12 }}><div style={subLabel}>Why it fits</div><BulletList items={why} color={T.TEXT} /></div>
      )}
      {risk.length > 0 && (
        <div style={{ marginBottom: 12 }}><div style={subLabel}>Risks / watch-outs</div><BulletList items={risk} color={T.MUTED} /></div>
      )}
      {nextStep && (
        <div><div style={subLabel}>Next step</div><div style={{ fontSize: 13, color: T.TEXT, lineHeight: "19px" }}>{nextStep}</div></div>
      )}
      {!decision && score === null && why.length === 0 && risk.length === 0 && !nextStep && (
        <Empty>This run has no detailed jobfit fields.</Empty>
      )}
    </div>
  )
}

function CoverLetterSection({ coverLetter }: { coverLetter: any }) {
  if (!coverLetter || typeof coverLetter !== "object") {
    return <Empty>Cover letter not generated for this job.</Empty>
  }
  const letter = typeof coverLetter.letter === "string" ? coverLetter.letter : null
  const contact = coverLetter.contact
  const contactLines: [string, string][] =
    contact && typeof contact === "object"
      ? Object.entries(contact).filter(([, v]) => v != null && String(v).trim() !== "").map(([k, v]) => [k, String(v)] as [string, string])
      : []
  return (
    <div>
      {typeof contact === "string" && contact.trim() !== "" && (
        <div style={{ marginBottom: 10, fontSize: 12, color: T.MUTED }}>{contact}</div>
      )}
      {contactLines.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", gap: "2px 16px" }}>
          {contactLines.map(([k, v]) => (
            <span key={k} style={{ fontSize: 12, color: T.MUTED }}><span style={{ color: T.DIM }}>{k}:</span> {v}</span>
          ))}
        </div>
      )}
      {letter
        ? <div style={{ fontSize: 13, color: T.TEXT, lineHeight: "20px", whiteSpace: "pre-wrap" }}>{letter}</div>
        : <Empty>No letter body on this run.</Empty>}
    </div>
  )
}

function Collapsible({ title, accent, open, onToggle, children }: {
  title: string; accent: string; open: boolean; onToggle: () => void; children: React.ReactNode
}) {
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.CARD, marginBottom: 14, overflow: "hidden" }}>
      <div
        onClick={onToggle}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", padding: "12px 14px" }}
      >
        <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1.5, color: accent }}>{title}</span>
        <span style={{ fontSize: 12, color: T.DIM }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  )
}

export function JobDetailPanel({ open, onClose, clientProfileId, applicationId, initialSection }: {
  open: boolean
  onClose: () => void
  clientProfileId: string
  applicationId: string | null
  initialSection: PanelSection
}) {
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [jobfitOpen, setJobfitOpen] = useState(true)
  const [coverOpen, setCoverOpen] = useState(false)

  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true); setError(null); setData(null)
    try {
      const res = await authFetch(`/api/coach/clients/${clientProfileId}/applications/${applicationId}/detail`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load details (${res.status})`); return }
      setData({ jobfit: j.jobfit ?? null, coverLetter: j.coverLetter ?? null })
    } catch {
      setError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [clientProfileId, applicationId])

  // On each open: focus the clicked section, collapse the other, (re)fetch.
  useEffect(() => {
    if (!open) return
    setJobfitOpen(initialSection !== "coverletter")
    setCoverOpen(initialSection === "coverletter")
    void load()
  }, [open, initialSection, load])

  // Escape closes.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(4, 6, 15, 0.55)",
          opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.18s ease-out", zIndex: 40,
        }}
      />
      {/* Slide-in panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Job detail"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520, maxWidth: "96vw",
          background: T.NAV_BG, borderLeft: `1px solid ${T.BORDER}`,
          boxShadow: "-20px 0 60px rgba(0,0,0,0.4)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s ease-out", zIndex: 41,
          display: "flex", flexDirection: "column",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${T.BORDER_SOFT}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...eyebrow, color: T.WRN_ORANGE, fontSize: 9, marginBottom: 4 }}>JOB DETAIL</div>
            <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>Full analysis</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: T.MUTED, fontSize: 20, cursor: "pointer", padding: 4 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 28px" }}>
          {loading && <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading…</p>}
          {error && !loading && (
            <div>
              <div style={{ fontSize: 12, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>{error}</div>
              <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
            </div>
          )}
          {!loading && !error && data && (
            <>
              <Collapsible title="FULL JOBFIT" accent={T.WRN_BLUE} open={jobfitOpen} onToggle={() => setJobfitOpen((o) => !o)}>
                <JobfitSection jobfit={data.jobfit} />
              </Collapsible>
              <Collapsible title="COVER LETTER" accent={T.WRN_TEAL} open={coverOpen} onToggle={() => setCoverOpen((o) => !o)}>
                <CoverLetterSection coverLetter={data.coverLetter} />
              </Collapsible>
            </>
          )}
        </div>
      </div>
    </>
  )
}
