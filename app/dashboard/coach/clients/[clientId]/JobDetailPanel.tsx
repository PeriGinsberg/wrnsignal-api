"use client"

// JobDetailPanel — one slide-in panel per job, opened from a Job Tracker row's
// "Full Jobfit" / "Positioning" / "Cover Letter" link. Shows every artifact
// section (collapsible), opens focused on whichever link was clicked, and under
// JobFit and Cover Letter a coach can read + write notes about that artifact.
// A full-access coach can run Positioning and Cover Letter for the client from
// here; the result is stored on the client's profile, where the client sees it.
//
// Reads:
//   GET  /api/coach/clients/[clientId]/applications/[applicationId]/detail  (content)
//   GET  /api/coach/clients/[clientId]/applications/[applicationId]/notes   (this job's notes)
// Writes:
//   POST /api/coach/clients/[clientId]/applications/[applicationId]/notes   ({ artifact_type, body, visibility })
//   POST /api/positioning?client_profile_id=[clientId]                       ({ application_id })
//   POST /api/coverletter?client_profile_id=[clientId]                       ({ application_id })
// All are coach-gated server-side (application owner -> lib/collab check);
// this component adds no access logic. can_run from the detail route only
// decides whether to OFFER the Run button.
//
// getToken/authFetch inlined per the coach-route client convention.

import { useCallback, useEffect, useState } from "react"
import { SPACE, TYPE } from "../../../../../lib/theme/surfaces"
import { T, btnPrimary, btnSecondary, eyebrow, textarea } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

export type PanelSection = "jobfit" | "positioning" | "coverletter"

type RunBy = "coach" | "client" | null
type Detail = {
  jobfit: any
  coverLetter: any
  positioning: any
  coverLetterBy: RunBy
  positioningBy: RunBy
  canRun: boolean
}
type Note = {
  id: string
  artifact_type: "jobfit" | "coverletter"
  body: string
  visibility: "private" | "shared"
  author_role: string
  created_at: string
}

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = await getToken()
  return fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } })
}

// ── render helpers ──
function pickArray(a: unknown, b: unknown): any[] {
  if (Array.isArray(a)) return a
  if (Array.isArray(b)) return b
  return []
}
function decisionTint(decision: string | null): { bg: string; color: string } {
  const d = (decision || "").toLowerCase()
  if (d.includes("pass")) return { bg: T.SUCCESS_BG, color: T.SUCCESS }
  if (d.includes("fail") || d.includes("no")) return { bg: T.ERROR_BG, color: T.ERROR }
  return { bg: T.WARNING_BG, color: T.INK_EMPHASIS }
}
function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString()
}
const subLabel: React.CSSProperties = {
  fontSize: TYPE.label, fontWeight: 900, letterSpacing: 1.5,
  textTransform: "uppercase", color: T.DIM, marginBottom: 6,
}
function BulletList({ items, color }: { items: any[]; color: string }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map((b, i) => <li key={i} style={{ fontSize: TYPE.secondary, color, lineHeight: "19px" }}>{String(b)}</li>)}
    </ul>
  )
}
function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: TYPE.secondary, color: T.DIM }}>{children}</div>
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
        <div style={{ fontSize: TYPE.body, fontWeight: 800, color: T.TEXT, marginBottom: 8 }}>
          {jobTitle || "Untitled role"}{companyName ? <span style={{ color: T.MUTED, fontWeight: 600 }}> · {companyName}</span> : null}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        {decision && <span style={{ fontSize: TYPE.secondary, fontWeight: 900, padding: "3px 10px", borderRadius: 999, background: tint.bg, color: tint.color }}>{decision}</span>}
        {score !== null && <span style={{ fontSize: TYPE.secondary, color: T.DIM }}>Score: <span style={{ color: T.TEXT, fontWeight: 900 }}>{score}</span></span>}
      </div>
      {why.length > 0 && (
        <div style={{ marginBottom: 12 }}><div style={subLabel}>Why it fits</div><BulletList items={why} color={T.TEXT} /></div>
      )}
      {risk.length > 0 && (
        <div style={{ marginBottom: 12 }}><div style={subLabel}>Risks / watch-outs</div><BulletList items={risk} color={T.MUTED} /></div>
      )}
      {nextStep && (
        <div><div style={subLabel}>Next step</div><div style={{ fontSize: TYPE.secondary, color: T.TEXT, lineHeight: "19px" }}>{nextStep}</div></div>
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
        <div style={{ marginBottom: 10, fontSize: TYPE.secondary, color: T.MUTED }}>{contact}</div>
      )}
      {contactLines.length > 0 && (
        <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", gap: "2px 16px" }}>
          {contactLines.map(([k, v]) => (
            <span key={k} style={{ fontSize: TYPE.secondary, color: T.MUTED }}><span style={{ color: T.DIM }}>{k}:</span> {v}</span>
          ))}
        </div>
      )}
      {letter
        ? <div style={{ fontSize: TYPE.secondary, color: T.TEXT, lineHeight: "20px", whiteSpace: "pre-wrap" }}>{letter}</div>
        : <Empty>No letter body on this run.</Empty>}
    </div>
  )
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : ""
}

// The positioning result_json from POST /api/positioning (finalResult in
// app/api/positioning/route.ts). Every field is read defensively: older runs
// predate some of them.
function PositioningSection({ positioning }: { positioning: any }) {
  if (!positioning || typeof positioning !== "object") {
    return <Empty>Positioning not generated for this job.</Empty>
  }
  const p = positioning
  const angle = p.role_angle && typeof p.role_angle === "object" ? p.role_angle : null
  const arrange = p.arrange_resume && typeof p.arrange_resume === "object" ? p.arrange_resume : null
  const summary = p.summary_statement && typeof p.summary_statement === "object" ? p.summary_statement : null
  const edits: any[] = Array.isArray(p.resume_bullet_edits) ? p.resume_bullet_edits : []
  const kw = p.keyword_analysis && typeof p.keyword_analysis === "object" ? p.keyword_analysis : null
  const groups: [string, string][] = [
    ["lead_with", "Lead with"], ["support_with", "Support with"],
    ["then_include", "Then include"], ["de_emphasize", "De-emphasize"],
  ]
  const block: React.CSSProperties = { marginBottom: 14 }
  const body: React.CSSProperties = { fontSize: TYPE.secondary, color: T.TEXT, lineHeight: "19px" }
  return (
    <div data-testid="positioning-result">
      {angle && (str(angle.label) || str(angle.why)) && (
        <div style={block}>
          <div style={subLabel}>Role angle</div>
          {str(angle.label) && <div style={{ ...body, fontWeight: 800, marginBottom: 4 }}>{str(angle.label)}</div>}
          {str(angle.why) && <div style={body}>{str(angle.why)}</div>}
        </div>
      )}
      {arrange && (
        <div style={block}>
          <div style={subLabel}>Arrange the resume</div>
          {str(arrange.intro) && <div style={{ ...body, marginBottom: 8 }}>{str(arrange.intro)}</div>}
          {groups.map(([key, label]) => {
            const picks: any[] = Array.isArray(arrange[key]) ? arrange[key] : []
            if (picks.length === 0) return null
            return (
              <div key={key} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: TYPE.secondary, fontWeight: 800, color: T.MUTED, marginBottom: 4 }}>{label}</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
                  {picks.map((x, i) => (
                    <li key={i} style={body}>
                      <span style={{ fontWeight: 700 }}>{str(x?.role) || "Experience"}</span>
                      {str(x?.action) ? `: ${str(x.action)}` : ""}
                      {str(x?.why) && <div style={{ color: T.MUTED }}>{str(x.why)}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
      {summary && (
        <div style={block}>
          <div style={subLabel}>Summary statement</div>
          {str(summary.why) && <div style={body}>{str(summary.why)}</div>}
          {str(summary.recommended_summary) && (
            <div style={{ ...body, marginTop: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.BORDER_SOFT}`, whiteSpace: "pre-wrap" }}>
              {str(summary.recommended_summary)}
            </div>
          )}
        </div>
      )}
      {edits.length > 0 && (
        <div style={block}>
          <div style={subLabel}>Bullet rewrites</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {edits.map((e, i) => (
              <div key={i} style={{ paddingLeft: 8, borderLeft: `2px solid ${T.BORDER_SOFT}` }}>
                {str(e?.job_title) && <div style={{ fontSize: TYPE.label, fontWeight: 800, color: T.DIM, marginBottom: 2 }}>{str(e.job_title)}</div>}
                <div style={{ ...body, color: T.MUTED, textDecoration: "line-through" }}>{str(e?.before)}</div>
                <div style={{ ...body, marginTop: 2 }}>{str(e?.after)}</div>
                {str(e?.why) && <div style={{ fontSize: TYPE.label, color: T.DIM, marginTop: 2 }}>{str(e.why)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {kw && (
        <div>
          <div style={subLabel}>Keywords</div>
          {typeof kw.coverage_pct === "number" && <div style={body}>Coverage: <span style={{ fontWeight: 900 }}>{kw.coverage_pct}%</span></div>}
          {strs(kw.missing_high_priority).length > 0 && (
            <div style={{ ...body, color: T.MUTED, marginTop: 4 }}>Missing: {strs(kw.missing_high_priority).join(", ")}</div>
          )}
        </div>
      )}
    </div>
  )
}

// Who made the stored result, and the Run / Re-run action for a full-access
// coach. "coach" covers any coach acting for this client, a delegate included.
export function RunBar({ kind, hasResult, by, canRun, running, error, onRun }: {
  kind: "Positioning" | "Cover Letter"
  hasResult: boolean
  by: RunBy
  canRun: boolean
  running: boolean
  error: string | null
  onRun: () => void
}) {
  const who = !hasResult ? null : by === "coach" ? "Generated by a coach" : "Generated by the client"
  if (!who && !canRun) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {who && <span style={{ fontSize: TYPE.label, fontWeight: 800, color: T.DIM }}>{who}</span>}
        {canRun && (
          <button
            type="button"
            onClick={onRun}
            disabled={running}
            style={{ ...(hasResult ? btnSecondary : btnPrimary), padding: "7px 14px", fontSize: TYPE.secondary, marginLeft: "auto", opacity: running ? 0.6 : 1 }}
          >
            {running ? "Running…" : hasResult ? `Re-run ${kind}` : `Run ${kind}`}
          </button>
        )}
      </div>
      {error && <div role="alert" style={{ fontSize: TYPE.micro, color: T.ERROR, marginTop: 6 }}>{error}</div>}
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
        <span style={{ fontSize: TYPE.micro, fontWeight: 900, letterSpacing: 1.5, color: accent }}>{title}</span>
        <span style={{ fontSize: TYPE.secondary, color: T.DIM }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  )
}

// ── Notes ──
function VisibilityChip({ active, label, color, disabled, onClick }: {
  active: boolean; label: string; color: string; disabled?: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: TYPE.micro, fontWeight: 800, padding: "4px 11px", borderRadius: 999,
        cursor: disabled ? "default" : "pointer",
        border: `1px solid ${active ? color : T.BORDER_SOFT}`,
        background: active ? `${color}22` : "transparent",
        color: active ? color : T.MUTED,
      }}
    >
      {label}
    </button>
  )
}

function NoteRow({ note }: { note: Note }) {
  const shared = note.visibility === "shared"
  return (
    <div style={{ paddingLeft: 8, borderLeft: `2px solid ${shared ? T.WRN_TEAL : T.DIM}` }}>
      <div style={{ fontSize: TYPE.secondary, color: T.TEXT, lineHeight: "17px", whiteSpace: "pre-wrap" }}>{note.body}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
        <span style={{
          fontSize: TYPE.micro, fontWeight: 900, letterSpacing: 0.5, padding: "1px 6px", borderRadius: 999,
          border: `1px solid ${T.BORDER_SOFT}`, color: shared ? T.WRN_TEAL : T.DIM,
        }}>
          {shared ? "SHARED" : "PRIVATE"}
        </span>
        <span style={{ fontSize: TYPE.label, color: T.DIM }}>{fmtDate(note.created_at)}</span>
      </div>
    </div>
  )
}

function NotesBlock({ artifactType, notes, loading, onSave }: {
  artifactType: Note["artifact_type"]
  notes: Note[]
  loading: boolean
  onSave: (artifactType: Note["artifact_type"], body: string, visibility: "private" | "shared") => Promise<{ ok: boolean; error?: string }>
}) {
  const [text, setText] = useState("")
  const [visibility, setVisibility] = useState<"private" | "shared">("private")
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = artifactType === "jobfit" ? "jobfit" : "cover letter"

  async function doSave() {
    const body = text.trim()
    if (!body) { setError("Write a note first."); return }
    setSaving(true); setError(null)
    const res = await onSave(artifactType, body, visibility)
    setSaving(false)
    if (!res.ok) { setError(res.error || "Couldn't save the note."); return }
    setText(""); setVisibility("private"); setConfirming(false)
  }

  function onSaveClick() {
    const body = text.trim()
    if (!body) { setError("Write a note first."); return }
    setError(null)
    // Shared needs an explicit confirm; private saves straight away.
    if (visibility === "shared") { setConfirming(true); return }
    void doSave()
  }

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${T.BORDER_SOFT}`, paddingTop: 12 }}>
      <div style={subLabel}>Notes</div>

      {loading ? (
        <div style={{ fontSize: TYPE.secondary, color: T.DIM, marginBottom: 10 }}>Loading notes…</div>
      ) : notes.length === 0 ? (
        <div style={{ fontSize: TYPE.secondary, color: T.DIM, marginBottom: 10 }}>No notes yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
          {notes.map((n) => <NoteRow key={n.id} note={n} />)}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Add a note about the ${label}…`}
        disabled={saving}
        style={{ ...textarea, minHeight: 56, fontSize: TYPE.secondary }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <VisibilityChip active={visibility === "private"} label="Private" color={T.DIM} disabled={saving || confirming} onClick={() => setVisibility("private")} />
        <VisibilityChip active={visibility === "shared"} label="Shared" color={T.INK_EMPHASIS} disabled={saving || confirming} onClick={() => setVisibility("shared")} />
        <button
          type="button"
          onClick={onSaveClick}
          disabled={saving || confirming}
          style={{ ...btnPrimary, padding: "8px 16px", fontSize: TYPE.secondary, marginLeft: "auto", opacity: saving || confirming ? 0.6 : 1 }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {confirming && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: `1px solid ${T.WRN_TEAL}55`, background: `${T.WRN_TEAL}14` }}>
          <div style={{ fontSize: TYPE.secondary, color: T.TEXT }}>Share with client? This can&apos;t be undone.</div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" onClick={() => void doSave()} disabled={saving} style={{ ...btnPrimary, padding: "7px 14px", fontSize: TYPE.secondary }}>
              {saving ? "Sharing…" : "Share note"}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={saving} style={{ ...btnSecondary, padding: "7px 14px", fontSize: TYPE.secondary }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <div style={{ fontSize: TYPE.micro, color: T.ERROR, marginTop: 6 }}>{error}</div>}
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
  const [positioningOpen, setPositioningOpen] = useState(false)
  const [coverOpen, setCoverOpen] = useState(false)
  const [running, setRunning] = useState<"positioning" | "coverletter" | null>(null)
  const [runError, setRunError] = useState<{ kind: "positioning" | "coverletter"; message: string } | null>(null)
  const [notes, setNotes] = useState<Note[]>([])
  const [notesLoading, setNotesLoading] = useState(false)

  const load = useCallback(async () => {
    if (!applicationId) return
    setLoading(true); setError(null); setData(null)
    try {
      const res = await authFetch(`/api/coach/clients/${clientProfileId}/applications/${applicationId}/detail`)
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load details (${res.status})`); return }
      setData({
        jobfit: j.jobfit ?? null,
        coverLetter: j.coverLetter ?? null,
        positioning: j.positioning ?? null,
        coverLetterBy: j.coverLetterBy ?? null,
        positioningBy: j.positioningBy ?? null,
        canRun: j.can_run === true,
      })
    } catch {
      setError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [clientProfileId, applicationId])

  const loadNotes = useCallback(async () => {
    if (!applicationId) { setNotes([]); return }
    setNotesLoading(true)
    try {
      const res = await authFetch(`/api/coach/clients/${clientProfileId}/applications/${applicationId}/notes`)
      const j = await res.json().catch(() => ({}))
      setNotes(res.ok && j?.ok && Array.isArray(j.notes) ? j.notes : [])
    } catch {
      setNotes([])
    } finally {
      setNotesLoading(false)
    }
  }, [clientProfileId, applicationId])

  // Runs on the CLIENT's profile: ?client_profile_id= names them, and the
  // server reads the job, JobFit result and persona from their own JobFit run.
  // The stored result then reloads from the detail route, so what the panel
  // shows is what the client will see.
  const run = useCallback(
    async (kind: "positioning" | "coverletter") => {
      if (!applicationId) return
      setRunning(kind); setRunError(null)
      try {
        const res = await authFetch(`/api/${kind}?client_profile_id=${encodeURIComponent(clientProfileId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ application_id: applicationId }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) {
          setRunError({ kind, message: j?.detail || j?.error || `Run failed (${res.status})` })
          return
        }
        await load()
      } catch {
        setRunError({ kind, message: "Network error — try again" })
      } finally {
        setRunning(null)
      }
    },
    [clientProfileId, applicationId, load],
  )

  const saveNote = useCallback(
    async (artifactType: Note["artifact_type"], body: string, visibility: "private" | "shared") => {
      if (!applicationId) return { ok: false, error: "No application" }
      try {
        const res = await authFetch(`/api/coach/clients/${clientProfileId}/applications/${applicationId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifact_type: artifactType, body, visibility }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok || !j?.ok) return { ok: false, error: j?.error || `Save failed (${res.status})` }
        await loadNotes()
        return { ok: true }
      } catch {
        return { ok: false, error: "Network error — try again" }
      }
    },
    [clientProfileId, applicationId, loadNotes],
  )

  // On each open: focus the clicked section, collapse the other, (re)fetch both.
  useEffect(() => {
    if (!open) return
    setJobfitOpen(initialSection === "jobfit")
    setPositioningOpen(initialSection === "positioning")
    setCoverOpen(initialSection === "coverletter")
    setRunError(null)
    void load()
    void loadNotes()
  }, [open, initialSection, load, loadNotes])

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
            <div style={{ ...eyebrow, color: T.INK_EMPHASIS, fontSize: TYPE.micro, marginBottom: 4 }}>JOB DETAIL</div>
            <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, letterSpacing: -0.3 }}>Full analysis</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "none", border: "none", color: T.MUTED, fontSize: 20, cursor: "pointer", padding: 4 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px 28px" }}>
          {loading && <p style={{ fontSize: TYPE.secondary, color: T.MUTED, margin: 0 }}>Loading…</p>}
          {error && !loading && (
            <div>
              <div style={{ fontSize: TYPE.secondary, color: T.ERROR, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.30)", borderRadius: 10, padding: "10px 12px" }}>{error}</div>
              <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
            </div>
          )}
          {!loading && !error && data && (
            <>
              <Collapsible title="FULL JOBFIT" accent={T.INK_LINK} open={jobfitOpen} onToggle={() => setJobfitOpen((o) => !o)}>
                <JobfitSection jobfit={data.jobfit} />
                <NotesBlock
                  artifactType="jobfit"
                  notes={notes.filter((n) => n.artifact_type === "jobfit")}
                  loading={notesLoading}
                  onSave={saveNote}
                />
              </Collapsible>
              <Collapsible title="POSITIONING" accent={T.WRN_TEAL} open={positioningOpen} onToggle={() => setPositioningOpen((o) => !o)}>
                <RunBar
                  kind="Positioning"
                  hasResult={!!data.positioning}
                  by={data.positioningBy}
                  canRun={data.canRun}
                  running={running === "positioning"}
                  error={runError?.kind === "positioning" ? runError.message : null}
                  onRun={() => void run("positioning")}
                />
                <PositioningSection positioning={data.positioning} />
              </Collapsible>
              <Collapsible title="COVER LETTER" accent={T.INK_EMPHASIS} open={coverOpen} onToggle={() => setCoverOpen((o) => !o)}>
                <RunBar
                  kind="Cover Letter"
                  hasResult={!!data.coverLetter}
                  by={data.coverLetterBy}
                  canRun={data.canRun}
                  running={running === "coverletter"}
                  error={runError?.kind === "coverletter" ? runError.message : null}
                  onRun={() => void run("coverletter")}
                />
                <CoverLetterSection coverLetter={data.coverLetter} />
                <NotesBlock
                  artifactType="coverletter"
                  notes={notes.filter((n) => n.artifact_type === "coverletter")}
                  loading={notesLoading}
                  onSave={saveNote}
                />
              </Collapsible>
            </>
          )}
        </div>
      </div>
    </>
  )
}
