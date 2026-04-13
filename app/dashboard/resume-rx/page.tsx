"use client"

import { useEffect, useState, useCallback } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"
import {
  T,
  input,
  textarea,
  btnPrimary,
  btnSecondary,
  card,
  eyebrow,
  headline,
  label,
} from "../../../lib/dashboard-theme"

// ─── helpers ────────────────────────────────────────────────────────────────

async function getToken(): Promise<string | null> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  if (session?.access_token) return session.access_token
  return sessionStorage.getItem("signal_handoff_token")
}

async function authFetch(url: string, opts: RequestInit = {}) {
  const token = await getToken()
  if (!token) throw new Error("Not authenticated")
  return fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers ?? {}),
    },
  })
}

// ─── sub-components ─────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, padding: "12px 20px",
      borderRadius: 12, background: T.SUCCESS_BG, border: "1px solid rgba(74,222,128,0.25)",
      color: T.SUCCESS, fontSize: 13, fontWeight: 900, zIndex: 100,
    }}>
      {message}
    </div>
  )
}

function ProgressDots({ score }: { score: number }) {
  const filled = Math.round((score / 100) * 5)
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {[0,1,2,3,4].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%",
          background: i < filled ? T.WRN_ORANGE : T.BORDER,
        }} />
      ))}
    </div>
  )
}

function SectionDivider({ label: lbl }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0 16px" }}>
      <div style={{ flex: 1, height: 1, background: T.BORDER_SOFT }} />
      <span style={{ ...eyebrow, color: T.DIM, fontSize: 9 }}>{lbl}</span>
      <div style={{ flex: 1, height: 1, background: T.BORDER_SOFT }} />
    </div>
  )
}

// ─── main page ──────────────────────────────────────────────────────────────

export default function ResumeRxPage() {
  const [stage, setStage] = useState<string>("entry")
  const [loading, setLoading] = useState(true)
  const [existingResume, setExistingResume] = useState<any>(null)
  const [pastSessions, setPastSessions] = useState<any[]>([])
  const [resumeText, setResumeText] = useState("")
  const [sourcePersonaId, setSourcePersonaId] = useState<string | null>(null)
  const [mode, setMode] = useState("")
  const [yearInSchool, setYearInSchool] = useState("")
  const [targetField, setTargetField] = useState("")
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<any>(null)
  const [educationData, setEducationData] = useState<any>(null)
  const [educationProposal, setEducationProposal] = useState<any>(null)
  const [architecture, setArchitecture] = useState<any>(null)
  const [qaItems, setQaItems] = useState<any[]>([])
  const [qaIndex, setQaIndex] = useState(0)
  const [qaAnswers, setQaAnswers] = useState<Record<string, string>>({})
  const [qaResult, setQaResult] = useState<any>(null)
  const [qaLoading, setQaLoading] = useState(false)
  const [completionResult, setCompletionResult] = useState<any>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState("")

  const loadInitial = useCallback(async () => {
    setLoading(true)
    try {
      const [existRes, sessRes] = await Promise.all([
        authFetch("/api/resume-rx/existing-resume"),
        authFetch("/api/resume-rx/sessions"),
      ])
      if (existRes.ok) {
        const j = await existRes.json()
        setExistingResume(j)
        if (j?.hasResume && j?.resumeText) {
          setResumeText(j.resumeText)
          setSourcePersonaId(j?.personaId ?? null)
        }
      }
      if (sessRes.ok) {
        const j = await sessRes.json()
        setPastSessions(j?.sessions ?? [])
      }
    } catch {
      // silently skip — user may not be authed yet; layout handles auth
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadInitial() }, [loadInitial])

  // ── stage helpers ──────────────────────────────────────────────────────────

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const res = await authFetch("/api/resume-upload", { method: "POST", body: formData })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || "Upload failed")
      setResumeText(j.text)
      setSourcePersonaId(null)
      setToast("Resume uploaded")
    } catch (err: any) {
      setError(err?.message || "Upload failed. Try pasting your resume instead.")
    } finally {
      setUploading(false)
    }
  }

  async function startAnalysis() {
    if (!resumeText.trim()) { setError("Please provide your resume first."); return }
    if (!mode) { setError("Please select your career stage."); return }
    if (!targetField.trim()) { setError("Please enter your target field."); return }
    setError("")
    setAnalyzing(true)
    try {
      const res = await authFetch("/api/resume-rx/start", {
        method: "POST",
        body: JSON.stringify({ resume_text: resumeText, source_persona_id: sourcePersonaId, mode, year_in_school: yearInSchool, target_field: targetField }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || "Analysis failed")
      setSessionId(j.session_id)
      setDiagnosis(j.diagnosis)
      setQaItems(j.diagnosis?.qa_agenda ?? [])
      setStage("diagnosis")
    } catch (err: any) {
      setError(err?.message || "Analysis failed. Please try again.")
    } finally {
      setAnalyzing(false)
    }
  }

  async function confirmEducation() {
    if (!sessionId) return
    setError("")
    try {
      const res = await authFetch("/api/resume-rx/education", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, education: educationData }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || "Education step failed")
      setEducationProposal(j.proposal)
    } catch (err: any) {
      setError(err?.message || "Failed to generate education section.")
    }
  }

  async function approveEducation() {
    setStage("architecture")
    try {
      const res = await authFetch("/api/resume-rx/architecture", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, confirmed: true }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || "Architecture step failed")
      setArchitecture(j.architecture)
    } catch (err: any) {
      setError(err?.message || "Failed to load architecture.")
    }
  }

  async function startQA() {
    setStage("qa")
  }

  async function submitQAAnswer() {
    const item = qaItems[qaIndex]
    if (!item) return
    setQaLoading(true)
    setError("")
    try {
      const answers = qaAnswers[item.bullet_id] ?? ""
      const res = await authFetch("/api/resume-rx/answer", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, item_id: item.id, type: item.type || "bullet", original: item.target, section: item.section, answers }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || "Answer failed")
      setQaResult(j)
    } catch (err: any) {
      setError(err?.message || "Failed to generate rewrite.")
    } finally {
      setQaLoading(false)
    }
  }

  async function approveVariant(variantIndex: number) {
    const item = qaItems[qaIndex]
    if (!item) return
    setQaLoading(true)
    try {
      await authFetch("/api/resume-rx/approve", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, item_id: item.id, approved_bullets: [qaResult?.variants?.[variantIndex]?.text || ""], skipped: false }),
      })
      advanceQA()
    } catch (err: any) {
      setError(err?.message || "Failed to approve.")
    } finally {
      setQaLoading(false)
    }
  }

  function advanceQA() {
    setQaResult(null)
    if (qaIndex + 1 >= qaItems.length) {
      finishQA()
    } else {
      setQaIndex(qaIndex + 1)
    }
  }

  async function finishQA() {
    setStage("complete")
    try {
      const res = await authFetch("/api/resume-rx/complete", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j?.error || "Complete failed")
      setCompletionResult(j)
    } catch (err: any) {
      setError(err?.message || "Failed to load final result.")
    }
  }

  async function saveToProfile() {
    if (!sessionId) return
    try {
      const res = await authFetch("/api/resume-rx/save-to-profile", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId }),
      })
      if (res.ok) setToast("Resume saved to profile!")
      else {
        const j = await res.json()
        setError(j?.error || "Save failed.")
      }
    } catch (err: any) {
      setError(err?.message || "Save failed.")
    }
  }

  function copyResumeText() {
    const text = completionResult?.finalResume ?? ""
    navigator.clipboard.writeText(text).then(() => setToast("Copied to clipboard!"))
  }

  // ── loading / init ─────────────────────────────────────────────────────────

  if (loading) {
    return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>
  }

  const cardStyle = { ...card, marginBottom: 20 }

  // ── stage: ENTRY ──────────────────────────────────────────────────────────

  if (stage === "entry") {
    return (
      <div style={{ maxWidth: 720 }}>
        <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>RESUME RX</div>
        <h1 style={{ ...headline, fontSize: 30, letterSpacing: -1, marginBottom: 4 }}>
          Resume Rewrite
        </h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginBottom: 28, lineHeight: "20px" }}>
          Peri will diagnose your resume, then rebuild it bullet by bullet with you.
        </p>

        {error && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.25)", padding: 16 }}>
            <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Resume source */}
        {existingResume?.hasResume && !showUpload ? (
          <div style={cardStyle}>
            <div style={{ height: 3, background: T.GRAD_PRIMARY }} />
            <div style={{ padding: 24 }}>
              <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 12 } as React.CSSProperties}>YOUR RESUME ON FILE</div>
              <p style={{ fontSize: 13, color: T.MUTED, lineHeight: "20px", marginBottom: 16 }}>
                {existingResume.resumeText?.slice(0, 300)}{existingResume.resumeText?.length > 300 ? "..." : ""}
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => {
                    setResumeText(existingResume.resumeText)
                    setSourcePersonaId(existingResume.personaId ?? null)
                    setToast("Using resume on file")
                  }}
                  style={{ ...btnPrimary, fontSize: 13 }}
                >
                  Use this resume →
                </button>
                <button onClick={() => setShowUpload(true)} style={{ ...btnSecondary, fontSize: 13 }}>
                  Upload a different one
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={{ height: 3, background: T.GRAD_PRIMARY }} />
            <div style={{ padding: 24 }}>
              <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 12 } as React.CSSProperties}>UPLOAD OR PASTE RESUME</div>
              <label style={{
                display: "block", border: `2px dashed ${T.BORDER}`, borderRadius: 12,
                padding: 24, textAlign: "center", cursor: "pointer",
                background: T.GLASS, marginBottom: 12,
                opacity: uploading ? 0.5 : 1,
              }}>
                <input
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
                <div style={{ fontSize: 22, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, color: T.TEXT, fontWeight: 900 }}>
                  {uploading ? "Uploading..." : "Click to upload PDF, DOCX, or TXT"}
                </div>
                <div style={{ fontSize: 12, color: T.DIM, marginTop: 4 }}>or paste below</div>
              </label>
              <div style={{ ...eyebrow, color: T.DIM, marginBottom: 6 } as React.CSSProperties}>OR PASTE YOUR RESUME</div>
              <textarea
                style={{ ...textarea, minHeight: 160 }}
                placeholder="Paste your full resume text here..."
                value={resumeText}
                onChange={e => setResumeText(e.target.value)}
              />
              {showUpload && (
                <button
                  onClick={() => setShowUpload(false)}
                  style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, cursor: "pointer", marginTop: 8, padding: 0 }}
                >
                  Use resume on file instead
                </button>
              )}
            </div>
          </div>
        )}

        {/* Options */}
        <div style={cardStyle}>
          <div style={{ padding: 24 }}>
            <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 } as React.CSSProperties}>ABOUT YOU</div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>CAREER STAGE</span>
                <select
                  style={{ ...input, cursor: "pointer", colorScheme: "dark" } as React.CSSProperties}
                  value={mode}
                  onChange={e => setMode(e.target.value)}
                >
                  <option value="" disabled style={{ background: "#0a1628" }}>Select your stage...</option>
                  <option value="student_internship" style={{ background: "#0a1628" }}>Student Seeking Internship</option>
                  <option value="student_first_job" style={{ background: "#0a1628" }}>Student Seeking First Job</option>
                  <option value="early_professional" style={{ background: "#0a1628" }}>Early Professional Changing Roles</option>
                </select>
              </div>

              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>YEAR IN SCHOOL</span>
                <select
                  style={{ ...input, cursor: "pointer", colorScheme: "dark" } as React.CSSProperties}
                  value={yearInSchool}
                  onChange={e => setYearInSchool(e.target.value)}
                >
                  <option value="" style={{ background: "#0a1628" }}>Select (optional)</option>
                  <option value="freshman" style={{ background: "#0a1628" }}>Freshman</option>
                  <option value="sophomore" style={{ background: "#0a1628" }}>Sophomore</option>
                  <option value="junior" style={{ background: "#0a1628" }}>Junior</option>
                  <option value="senior" style={{ background: "#0a1628" }}>Senior</option>
                  <option value="graduate" style={{ background: "#0a1628" }}>Graduate Student</option>
                  <option value="recent_grad" style={{ background: "#0a1628" }}>Recent Graduate</option>
                </select>
              </div>

              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>TARGET FIELD</span>
                <input
                  type="text"
                  list="target-field-list"
                  style={input}
                  placeholder="e.g. Marketing, Finance, Consulting..."
                  value={targetField}
                  onChange={e => setTargetField(e.target.value)}
                />
                <datalist id="target-field-list">
                  {["Marketing","Finance","Consulting","Technology","Operations","Human Resources","Non-Profit","Healthcare","Law","Other"].map(f => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
              </div>
            </div>
          </div>
        </div>

        <button
          onClick={startAnalysis}
          disabled={analyzing || !resumeText.trim() || !mode || !targetField.trim()}
          style={{
            ...btnPrimary,
            fontSize: 15,
            padding: "15px 28px",
            opacity: (analyzing || !resumeText.trim() || !mode || !targetField.trim()) ? 0.5 : 1,
            cursor: (analyzing || !resumeText.trim() || !mode || !targetField.trim()) ? "not-allowed" : "pointer",
            marginBottom: 32,
          }}
        >
          {analyzing ? "Analyzing... ~30 seconds" : "Analyze My Resume →"}
        </button>

        {/* Past sessions */}
        {pastSessions.length > 0 && (
          <div>
            <SectionDivider label="Past Sessions" />
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {pastSessions.map((s: any) => (
                <div key={s.id} style={{ ...card, padding: "14px 18px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 13, color: T.TEXT, fontWeight: 900 }}>{s.targetField ?? "Resume Session"}</div>
                    <div style={{ fontSize: 11, color: T.DIM, marginTop: 2 }}>
                      {s.createdAt ? new Date(s.createdAt).toLocaleDateString() : ""} · {s.mode ?? ""}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase",
                    color: s.status === "complete" ? T.SUCCESS : T.WRN_ORANGE,
                    background: s.status === "complete" ? T.SUCCESS_BG : T.WARNING_BG,
                    padding: "3px 8px", borderRadius: 6,
                  }}>
                    {s.status ?? "in progress"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    )
  }

  // ── stage: DIAGNOSIS ──────────────────────────────────────────────────────

  if (stage === "diagnosis") {
    const d = diagnosis ?? {}
    const verdict = d.overall_verdict ?? "needs_work"
    const verdictColor = verdict === "strong" ? T.SUCCESS : verdict === "decent" ? T.WRN_ORANGE : T.ERROR
    const verdictBg = verdict === "strong" ? T.SUCCESS_BG : verdict === "decent" ? T.WARNING_BG : T.ERROR_BG

    const dimensions = [
      { key: "impact", label: "IMPACT" },
      { key: "specificity", label: "SPECIFICITY" },
      { key: "language", label: "LANGUAGE" },
      { key: "relevance", label: "RELEVANCE" },
      { key: "completeness", label: "COMPLETENESS" },
      { key: "honesty", label: "HONESTY" },
    ]

    return (
      <div style={{ maxWidth: 760 }}>
        <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>RESUME RX — DIAGNOSIS</div>
        <h1 style={{ ...headline, fontSize: 28, letterSpacing: -1, marginBottom: 24 }}>Here's what I found.</h1>

        {error && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.25)", padding: 16 }}>
            <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Verdict banner */}
        <div style={{ ...card, padding: 20, marginBottom: 20, background: verdictBg, border: `1px solid ${verdictColor}33` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 10, height: 10, borderRadius: "50%", background: verdictColor, flexShrink: 0 }} />
            <div>
              <div style={{ ...eyebrow, color: verdictColor } as React.CSSProperties}>OVERALL VERDICT</div>
              <div style={{ fontSize: 18, fontWeight: 950, color: T.TEXT, marginTop: 4, letterSpacing: -0.3 }}>
                {d.verdict_headline ?? verdict}
              </div>
            </div>
          </div>
          {d.summary && (
            <p style={{ fontSize: 14, color: T.TEXT, marginTop: 14, lineHeight: "22px", borderTop: `1px solid ${T.BORDER_SOFT}`, paddingTop: 14 }}>
              {d.summary}
            </p>
          )}
        </div>

        {/* 7-second skim test */}
        {d.skim_test && (
          <div style={cardStyle}>
            <div style={{ padding: 20 }}>
              <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 10 } as React.CSSProperties}>7-SECOND SKIM TEST</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <div style={{ fontSize: 20 }}>{d.skim_test.pass ? "✓" : "✗"}</div>
                <span style={{ fontSize: 15, fontWeight: 900, color: d.skim_test.pass ? T.SUCCESS : T.ERROR }}>
                  {d.skim_test.pass ? "Passes" : "Fails"} the skim test
                </span>
              </div>
              {d.skim_test.items && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {d.skim_test.items.map((item: any, i: number) => (
                    <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ fontSize: 12, color: item.pass ? T.SUCCESS : T.ERROR, flexShrink: 0 }}>
                        {item.pass ? "✓" : "✗"}
                      </span>
                      <span style={{ fontSize: 13, color: T.MUTED }}>{item.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ATS issues */}
        {d.ats_issues?.length > 0 && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.15)" }}>
            <div style={{ padding: 20 }}>
              <div style={{ ...eyebrow, color: T.ERROR, marginBottom: 10 } as React.CSSProperties}>ATS ISSUES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {d.ats_issues.map((issue: string, i: number) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 12, color: T.ERROR, flexShrink: 0 }}>!</span>
                    <span style={{ fontSize: 13, color: T.MUTED }}>{issue}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Dimension scores */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
          {dimensions.map(({ key, label: lbl }) => {
            const dim = d.dimensions?.[key] ?? {}
            const score = typeof dim.score === "number" ? dim.score : 50
            return (
              <div key={key} style={card}>
                <div style={{ padding: "14px 16px" }}>
                  <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>{lbl}</div>
                  <ProgressDots score={score} />
                  <div style={{ fontSize: 11, color: T.MUTED, marginTop: 8, lineHeight: "17px" }}>
                    {dim.finding ?? ""}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* High school warning */}
        {d.should_remove_hs && (
          <div style={{ ...cardStyle, background: T.WARNING_BG, border: "1px solid rgba(254,176,106,0.2)", padding: 16 }}>
            <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 6 } as React.CSSProperties}>HIGH SCHOOL</div>
            <p style={{ fontSize: 13, color: T.TEXT, margin: 0 }}>
              You should remove your high school from this resume. It signals inexperience and takes up valuable space.
            </p>
          </div>
        )}

        {/* Missing opportunities */}
        {d.missing_opportunities?.length > 0 && (
          <div style={cardStyle}>
            <div style={{ padding: 20 }}>
              <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 10 } as React.CSSProperties}>MISSING OPPORTUNITIES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {d.missing_opportunities.map((opp: string, i: number) => (
                  <div key={i} style={{ display: "flex", gap: 8 }}>
                    <span style={{ fontSize: 13, color: T.WRN_ORANGE, flexShrink: 0 }}>→</span>
                    <span style={{ fontSize: 13, color: T.MUTED }}>{opp}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <button
          onClick={() => {
            const edu = d.current_education ?? {}
            setEducationData(edu)
            setStage("education")
          }}
          style={{ ...btnPrimary, fontSize: 15, padding: "15px 28px" }}
        >
          Start the Rewrite →
        </button>

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    )
  }

  // ── stage: EDUCATION ──────────────────────────────────────────────────────

  if (stage === "education") {
    const edu = educationData ?? {}
    return (
      <div style={{ maxWidth: 680 }}>
        <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>RESUME RX — STEP 1</div>
        <h1 style={{ ...headline, fontSize: 28, letterSpacing: -1, marginBottom: 6 }}>Confirm Your Education</h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginBottom: 24, lineHeight: "20px" }}>
          Let's make sure your education section is set up correctly before we start rewriting.
        </p>

        {error && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.25)", padding: 16 }}>
            <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>
          </div>
        )}

        <div style={cardStyle}>
          <div style={{ height: 3, background: T.GRAD_PRIMARY }} />
          <div style={{ padding: 24 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {[
                { key: "university", lbl: "UNIVERSITY NAME", placeholder: "e.g. University of Michigan" },
                { key: "location", lbl: "LOCATION", placeholder: "e.g. Ann Arbor, MI" },
                { key: "college", lbl: "COLLEGE / SCHOOL", placeholder: "e.g. Ross School of Business" },
                { key: "graduation_date", lbl: "GRADUATION DATE", placeholder: "e.g. May 2026" },
                { key: "majors", lbl: "MAJORS (comma-separated)", placeholder: "e.g. Marketing, Psychology" },
                { key: "minors", lbl: "MINORS (comma-separated)", placeholder: "e.g. Statistics" },
              ].map(({ key, lbl, placeholder }) => (
                <div key={key}>
                  <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>{lbl}</span>
                  <input
                    type="text"
                    style={input}
                    placeholder={placeholder}
                    value={edu[key] ?? ""}
                    onChange={e => setEducationData({ ...edu, [key]: e.target.value })}
                  />
                </div>
              ))}

              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>GPA</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max="4"
                  style={input}
                  placeholder="e.g. 3.72"
                  value={edu.gpa ?? ""}
                  onChange={e => setEducationData({ ...edu, gpa: parseFloat(e.target.value) })}
                />
              </div>

              {[
                { key: "honors", lbl: "HONORS (comma-separated)", placeholder: "e.g. Dean's List, Summa Cum Laude" },
                { key: "relevant_courses", lbl: "RELEVANT COURSES (comma-separated)", placeholder: "e.g. Corporate Finance, Data Analytics" },
              ].map(({ key, lbl, placeholder }) => (
                <div key={key}>
                  <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>{lbl}</span>
                  <input
                    type="text"
                    style={input}
                    placeholder={placeholder}
                    value={edu[key] ?? ""}
                    onChange={e => setEducationData({ ...edu, [key]: e.target.value })}
                  />
                </div>
              ))}

              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>STUDY ABROAD</span>
                <div style={{ display: "flex", gap: 10 }}>
                  {["Yes", "No"].map(opt => (
                    <button
                      key={opt}
                      onClick={() => setEducationData({ ...edu, study_abroad: opt === "Yes" })}
                      style={{
                        ...btnSecondary,
                        fontSize: 13,
                        padding: "10px 20px",
                        background: (edu.study_abroad === true && opt === "Yes") || (edu.study_abroad === false && opt === "No")
                          ? T.WARNING_BG : T.GLASS,
                        borderColor: (edu.study_abroad === true && opt === "Yes") || (edu.study_abroad === false && opt === "No")
                          ? "rgba(254,176,106,0.4)" : T.BORDER_SOFT,
                        color: (edu.study_abroad === true && opt === "Yes") || (edu.study_abroad === false && opt === "No")
                          ? T.WRN_ORANGE : T.MUTED,
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span style={{ ...label, color: T.WRN_BLUE, display: "block", marginBottom: 5 }}>ADDITIONAL NOTES</span>
                <textarea
                  style={{ ...textarea, minHeight: 80 }}
                  placeholder="Anything else relevant about your academic background..."
                  value={edu.additional_notes ?? ""}
                  onChange={e => setEducationData({ ...edu, additional_notes: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Proposal preview */}
        {educationProposal && (
          <div style={{ ...cardStyle, background: T.SUCCESS_BG, border: "1px solid rgba(74,222,128,0.2)" }}>
            <div style={{ padding: 20 }}>
              <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 10 } as React.CSSProperties}>EDUCATION SECTION PREVIEW</div>
              <pre style={{ fontSize: 13, color: T.TEXT, lineHeight: "20px", whiteSpace: "pre-wrap", margin: 0 }}>
                {typeof educationProposal === "string" ? educationProposal : JSON.stringify(educationProposal, null, 2)}
              </pre>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          {!educationProposal ? (
            <button onClick={confirmEducation} style={{ ...btnPrimary, fontSize: 15, padding: "15px 28px" }}>
              Confirm Education →
            </button>
          ) : (
            <button onClick={approveEducation} style={{ ...btnPrimary, fontSize: 15, padding: "15px 28px" }}>
              Looks Good →
            </button>
          )}
          <button onClick={() => setStage("diagnosis")} style={{ ...btnSecondary, fontSize: 13 }}>
            ← Back
          </button>
        </div>

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    )
  }

  // ── stage: ARCHITECTURE ───────────────────────────────────────────────────

  if (stage === "architecture") {
    const arch = architecture ?? {}
    return (
      <div style={{ maxWidth: 680 }}>
        <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>RESUME RX — STEP 2</div>
        <h1 style={{ ...headline, fontSize: 28, letterSpacing: -1, marginBottom: 6 }}>Resume Architecture</h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginBottom: 24, lineHeight: "20px" }}>
          Here's how we'll position and structure your resume.
        </p>

        {error && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.25)", padding: 16 }}>
            <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>
          </div>
        )}

        {!architecture ? (
          <div style={{ ...card, padding: 40, textAlign: "center" }}>
            <p style={{ color: T.MUTED, fontSize: 13 }}>Building your resume architecture...</p>
          </div>
        ) : (
          <>
            {/* Positioning statement */}
            {arch.positioning_statement && (
              <div style={{ ...cardStyle, background: "rgba(81,173,229,0.06)", border: "1px solid rgba(81,173,229,0.2)" }}>
                <div style={{ padding: 24 }}>
                  <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 12 } as React.CSSProperties}>POSITIONING STATEMENT</div>
                  <p style={{ fontSize: 16, color: T.TEXT, lineHeight: "26px", fontStyle: "italic", margin: 0 }}>
                    "{arch.positioning_statement}"
                  </p>
                </div>
              </div>
            )}

            {/* Section order */}
            {arch.section_order?.length > 0 && (
              <div style={cardStyle}>
                <div style={{ padding: 24 }}>
                  <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 14 } as React.CSSProperties}>SECTION ORDER</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {arch.section_order.map((section: string, i: number) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 12,
                        padding: "10px 14px", borderRadius: 10,
                        background: T.GLASS, border: `1px solid ${T.BORDER_SOFT}`,
                      }}>
                        <span style={{ fontSize: 11, fontWeight: 900, color: T.DIM, width: 20 }}>{i + 1}</span>
                        <span style={{ fontSize: 13, color: T.TEXT, fontWeight: 900 }}>{section}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Rationale */}
            {arch.rationale && (
              <div style={cardStyle}>
                <div style={{ padding: 20 }}>
                  <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>WHY THIS STRUCTURE</div>
                  <p style={{ fontSize: 13, color: T.MUTED, margin: 0, lineHeight: "20px" }}>{arch.rationale}</p>
                </div>
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={startQA}
            disabled={!architecture}
            style={{ ...btnPrimary, fontSize: 15, padding: "15px 28px", opacity: !architecture ? 0.5 : 1 }}
          >
            This looks right →
          </button>
          <button onClick={() => setStage("education")} style={{ ...btnSecondary, fontSize: 13 }}>
            ← Back
          </button>
        </div>

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    )
  }

  // ── stage: QA ─────────────────────────────────────────────────────────────

  if (stage === "qa") {
    const total = qaItems.length
    const item = qaItems[qaIndex]
    const progress = total > 0 ? ((qaIndex) / total) * 100 : 0

    return (
      <div style={{ maxWidth: 720 }}>
        <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 } as React.CSSProperties}>RESUME RX — REWRITE</div>
        <h1 style={{ ...headline, fontSize: 28, letterSpacing: -1, marginBottom: 6 }}>
          Bullet by Bullet
        </h1>

        {/* Progress bar */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: T.MUTED }}>Item {Math.min(qaIndex + 1, total)} of {total}</span>
            <span style={{ fontSize: 12, color: T.DIM }}>{Math.round(progress)}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 4, background: T.BORDER_SOFT }}>
            <div style={{ height: "100%", borderRadius: 4, background: T.GRAD_PRIMARY, width: `${progress}%`, transition: "width 0.3s" }} />
          </div>
        </div>

        {error && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.25)", padding: 16 }}>
            <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>
          </div>
        )}

        {!item ? (
          <div style={{ ...card, padding: 40, textAlign: "center" }}>
            <p style={{ color: T.SUCCESS, fontSize: 16, fontWeight: 900 }}>All done! Wrapping up...</p>
          </div>
        ) : (
          <>
            {/* Current item */}
            <div style={cardStyle}>
              <div style={{ height: 3, background: T.GRAD_PRIMARY }} />
              <div style={{ padding: 24 }}>
                <div style={{ ...eyebrow, color: T.DIM, marginBottom: 10 } as React.CSSProperties}>
                  {item.section ?? "BULLET"} · {item.context ?? ""}
                </div>

                {item.original && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 6 } as React.CSSProperties}>ORIGINAL</div>
                    <div style={{
                      fontSize: 13, color: T.MUTED, lineHeight: "20px",
                      padding: "10px 14px", background: T.GLASS, borderRadius: 10,
                      border: `1px solid ${T.BORDER_SOFT}`,
                    }}>
                      {item.original}
                    </div>
                  </div>
                )}

                {item.issue && (
                  <div style={{ marginBottom: 16, padding: "10px 14px", background: T.WARNING_BG, borderRadius: 10, border: "1px solid rgba(254,176,106,0.15)" }}>
                    <span style={{ ...eyebrow, color: T.WRN_ORANGE } as React.CSSProperties}>ISSUE: </span>
                    <span style={{ fontSize: 13, color: T.MUTED }}>{item.issue}</span>
                  </div>
                )}

                {/* Questions */}
                {item.questions?.length > 0 && !qaResult && (
                  <div>
                    <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 12 } as React.CSSProperties}>QUESTIONS</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {item.questions.map((q: string, qi: number) => (
                        <div key={qi}>
                          <p style={{ fontSize: 13, color: T.TEXT, marginBottom: 6, lineHeight: "20px" }}>{q}</p>
                          <textarea
                            style={{ ...textarea, minHeight: 70 }}
                            placeholder="Your answer..."
                            value={qaAnswers[`${item.bullet_id}_${qi}`] ?? ""}
                            onChange={e => setQaAnswers({ ...qaAnswers, [`${item.bullet_id}_${qi}`]: e.target.value })}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* No questions — free-form context box */}
                {(!item.questions || item.questions.length === 0) && !qaResult && (
                  <div>
                    <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 8 } as React.CSSProperties}>ADD CONTEXT (OPTIONAL)</div>
                    <textarea
                      style={{ ...textarea, minHeight: 80 }}
                      placeholder="Any additional details to help rewrite this bullet..."
                      value={qaAnswers[item.bullet_id] ?? ""}
                      onChange={e => setQaAnswers({ ...qaAnswers, [item.bullet_id]: e.target.value })}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Variants */}
            {qaResult?.variants && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 12 } as React.CSSProperties}>REWRITES</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {qaResult.variants.map((v: any, vi: number) => (
                    <div key={vi} style={{ ...card, padding: 0, overflow: "hidden" }}>
                      <div style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                          <p style={{ fontSize: 14, color: T.TEXT, lineHeight: "22px", flex: 1, margin: 0 }}>
                            {typeof v === "string" ? v : v.text ?? JSON.stringify(v)}
                          </p>
                          <button
                            onClick={() => approveVariant(vi)}
                            disabled={qaLoading}
                            style={{ ...btnPrimary, fontSize: 12, padding: "8px 16px", flexShrink: 0, opacity: qaLoading ? 0.5 : 1 }}
                          >
                            Use this
                          </button>
                        </div>
                        {v.note && (
                          <div style={{ fontSize: 11, color: T.DIM, marginTop: 8 }}>{v.note}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action row */}
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              {!qaResult ? (
                <button
                  onClick={submitQAAnswer}
                  disabled={qaLoading}
                  style={{ ...btnPrimary, fontSize: 14, padding: "13px 24px", opacity: qaLoading ? 0.5 : 1 }}
                >
                  {qaLoading ? "Generating..." : "Generate Rewrite →"}
                </button>
              ) : (
                <button
                  onClick={advanceQA}
                  style={{ ...btnSecondary, fontSize: 13 }}
                >
                  {qaIndex + 1 >= total ? "Finish →" : "Next →"}
                </button>
              )}
              <button
                onClick={advanceQA}
                style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, cursor: "pointer", padding: 0 }}
              >
                Skip
              </button>
            </div>
          </>
        )}

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    )
  }

  // ── stage: COMPLETE ───────────────────────────────────────────────────────

  if (stage === "complete") {
    const result = completionResult ?? {}

    return (
      <div style={{ maxWidth: 1040 }}>
        <div style={{ ...eyebrow, color: T.SUCCESS, marginBottom: 8 } as React.CSSProperties}>RESUME RX — COMPLETE</div>
        <h1 style={{ ...headline, fontSize: 30, letterSpacing: -1, marginBottom: 6 }}>Your Rewritten Resume</h1>
        <p style={{ fontSize: 13, color: T.MUTED, marginBottom: 24, lineHeight: "20px" }}>
          Here's what we built together. Review, copy, or save it to your profile.
        </p>

        {error && (
          <div style={{ ...cardStyle, background: T.ERROR_BG, border: "1px solid rgba(255,120,120,0.25)", padding: 16 }}>
            <p style={{ fontSize: 13, color: T.ERROR, margin: 0 }}>{error}</p>
          </div>
        )}

        {!completionResult ? (
          <div style={{ ...card, padding: 60, textAlign: "center" }}>
            <p style={{ color: T.MUTED, fontSize: 14 }}>Assembling your final resume...</p>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
            {/* Left: coaching summary */}
            <div style={{ width: 320, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
              {result.coaching_summary && (
                <>
                  {[
                    { key: "what_changed", title: "WHAT CHANGED" },
                    { key: "what_to_do_next", title: "WHAT TO DO NEXT" },
                    { key: "field_advice", title: "FIELD ADVICE" },
                    { key: "honest_assessment", title: "HONEST ASSESSMENT" },
                  ].map(({ key, title }) => result.coaching_summary[key] ? (
                    <div key={key} style={card}>
                      <div style={{ padding: "16px 18px" }}>
                        <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 8 } as React.CSSProperties}>{title}</div>
                        <p style={{ fontSize: 13, color: T.MUTED, margin: 0, lineHeight: "20px" }}>
                          {result.coaching_summary[key]}
                        </p>
                      </div>
                    </div>
                  ) : null)}
                </>
              )}

              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  onClick={saveToProfile}
                  style={{ ...btnPrimary, fontSize: 14, padding: "13px 18px", textAlign: "center" }}
                >
                  Save to Profile →
                </button>
                <button
                  onClick={copyResumeText}
                  style={{ ...btnSecondary, fontSize: 13, textAlign: "center" }}
                >
                  Copy Resume Text
                </button>
                <button
                  disabled
                  style={{ ...btnSecondary, fontSize: 13, textAlign: "center", opacity: 0.35, cursor: "not-allowed" }}
                  title="Coming soon"
                >
                  Download PDF (coming soon)
                </button>
              </div>

              <button
                onClick={() => {
                  setStage("entry")
                  setSessionId(null)
                  setDiagnosis(null)
                  setEducationProposal(null)
                  setArchitecture(null)
                  setQaItems([])
                  setQaIndex(0)
                  setQaAnswers({})
                  setQaResult(null)
                  setCompletionResult(null)
                  loadInitial()
                }}
                style={{ background: "none", border: "none", color: T.DIM, fontSize: 12, cursor: "pointer", padding: 0, textAlign: "left" }}
              >
                Start a new session
              </button>
            </div>

            {/* Right: final resume */}
            <div style={{ flex: 1 }}>
              <div style={card}>
                <div style={{ height: 3, background: T.GRAD_PRIMARY }} />
                <div style={{ padding: 28 }}>
                  <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 14 } as React.CSSProperties}>FINAL RESUME</div>
                  {result.finalResume ? (
                    <pre style={{
                      fontSize: 12, color: T.TEXT, lineHeight: "19px",
                      whiteSpace: "pre-wrap", margin: 0,
                      fontFamily: "'Courier New', monospace",
                      maxHeight: 720, overflowY: "auto",
                    }}>
                      {result.finalResume}
                    </pre>
                  ) : (
                    <p style={{ fontSize: 13, color: T.MUTED }}>Resume text not available.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      </div>
    )
  }

  // fallback
  return null
}
