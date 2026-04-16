"use client"

import { useState, useRef } from "react"
import { getSupabaseBrowser } from "../../../lib/supabase-browser"

/* ── Colors ──────────────────────────────────────────────────── */
const PLUM = "#3D1A4A"
const PLUM_TEXT = "#2A0F35"
const ROSE = "#C9607A"
const MUTED = "#9B6A8A"
const SUBTLE = "#C9A0B8"
const BORDER = "#EDD5E0"
const BG_HOVER = "#F8F0F5"
const SUCCESS = "#0F6E56"
const WARN = "#854F0B"

/* ── Shared styles ───────────────────────────────────────────── */
const sectionLabel: React.CSSProperties = {
  fontSize: 11, color: MUTED, letterSpacing: "0.08em",
  textTransform: "uppercase", marginBottom: 12, display: "block",
}

const inputStyle: React.CSSProperties = {
  width: "100%", border: `0.5px solid ${BORDER}`, borderRadius: 8,
  padding: "10px 14px", fontSize: 14, color: PLUM_TEXT,
  outline: "none", fontFamily: "inherit", boxSizing: "border-box",
}

const textareaStyle = (minH: number): React.CSSProperties => ({
  ...inputStyle, minHeight: minH, resize: "vertical",
})

const selectStyle: React.CSSProperties = {
  ...inputStyle, cursor: "pointer", appearance: "auto" as any,
}

/* ── Component ───────────────────────────────────────────────── */

export default function CreateClientModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  // Form fields
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [jobType, setJobType] = useState("")
  const [targetRoles, setTargetRoles] = useState("")
  const [targetLocations, setTargetLocations] = useState("")
  const [timeframe, setTimeframe] = useState("")
  const [resumeText, setResumeText] = useState("")
  const [hardConstraints, setHardConstraints] = useState("")
  const [strengths, setStrengths] = useState("")
  const [concerns, setConcerns] = useState("")

  // Resume tab
  const [resumeTab, setResumeTab] = useState<"paste" | "upload">("paste")
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Submit state
  const [submitting, setSubmitting] = useState(false)
  const [emailConflict, setEmailConflict] = useState("")
  const [generalError, setGeneralError] = useState("")
  const [result, setResult] = useState<{ ok: boolean; emailSent?: boolean } | null>(null)

  function reset() {
    setFirstName(""); setLastName(""); setEmail("")
    setJobType(""); setTargetRoles(""); setTargetLocations("")
    setTimeframe(""); setResumeText("")
    setHardConstraints(""); setStrengths(""); setConcerns("")
    setResumeTab("paste"); setUploadStatus(null)
    setEmailConflict(""); setGeneralError(""); setResult(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function getToken() {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    return session?.access_token || null
  }

  async function handleUpload(file: File) {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      setUploadStatus("File too large (max 5MB)")
      return
    }
    setUploading(true)
    setUploadStatus(null)
    try {
      const token = await getToken()
      if (!token) { setUploadStatus("Not authenticated"); return }
      const formData = new FormData()
      formData.append("file", file)
      const res = await fetch("/api/resume-upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const data = await res.json()
      if (res.ok && data.text) {
        setResumeText(data.text)
        setUploadStatus("Resume extracted")
      } else {
        setUploadStatus(data.error || "Extraction failed")
      }
    } catch {
      setUploadStatus("Upload failed")
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    setEmailConflict("")
    setGeneralError("")
    setSubmitting(true)
    try {
      const token = await getToken()
      if (!token) { setGeneralError("Not authenticated"); return }
      const res = await fetch("/api/coach/create-client", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName, lastName, email,
          jobType, targetRoles, targetLocations, timeframe,
          resumeText: resumeText || null,
          hardConstraints: hardConstraints || null,
          strengths: strengths || null,
          concerns: concerns || null,
        }),
      })
      const data = await res.json()

      if (res.status === 409) {
        setEmailConflict(data.error || "An account with this email already exists")
        return
      }
      if (!res.ok) {
        setGeneralError(data.error || "Something went wrong. Please try again.")
        return
      }

      setResult({ ok: true, emailSent: data.emailSent })

      if (data.emailSent === false) {
        setTimeout(() => { onSuccess() }, 4000)
      } else {
        setTimeout(() => { onSuccess() }, 2000)
      }
    } catch {
      setGeneralError("Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(42,15,53,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }}>
      <div style={{
        background: "#ffffff", borderRadius: 16,
        width: 560, maxWidth: "95vw", maxHeight: "88vh",
        overflowY: "auto", display: "flex", flexDirection: "column",
      }}>
        {/* ── Header ── */}
        <div style={{
          padding: "28px 32px 20px",
          borderBottom: `0.5px solid ${BORDER}`,
          position: "sticky", top: 0, background: "#ffffff", zIndex: 1,
        }}>
          <div style={{ fontSize: 22, fontWeight: 300, color: PLUM_TEXT }}>
            Create Client Account
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
            Set up SIGNAL for your client — an invite will be sent automatically
          </div>
          <button
            onClick={handleClose}
            style={{
              position: "absolute", top: 20, right: 24,
              fontSize: 18, color: MUTED, cursor: "pointer",
              background: "none", border: "none", lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* ── Body ── */}
        <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Section 1: Client Info */}
          <div>
            <span style={sectionLabel}>Client Info</span>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <input
                style={inputStyle}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
              <input
                style={inputStyle}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
            <input
              type="email"
              style={{ ...inputStyle, marginTop: 16 }}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailConflict("") }}
              placeholder="client@email.com"
            />
            {emailConflict && (
              <div style={{ fontSize: 12, color: ROSE, marginTop: 4 }}>{emailConflict}</div>
            )}
          </div>

          {/* Section 2: Job Search Details */}
          <div>
            <span style={sectionLabel}>Job Search Details</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <select
                style={selectStyle}
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
              >
                <option value="">Select job type...</option>
                <option value="Full-time">Full-time</option>
                <option value="Part-time">Part-time</option>
                <option value="Internship">Internship</option>
                <option value="Contract">Contract</option>
                <option value="Any">Any</option>
              </select>
              <input
                style={inputStyle}
                value={targetRoles}
                onChange={(e) => setTargetRoles(e.target.value)}
                placeholder="e.g. Product Manager, Business Analyst"
              />
              <input
                style={inputStyle}
                value={targetLocations}
                onChange={(e) => setTargetLocations(e.target.value)}
                placeholder="e.g. New York, Remote, Austin TX"
              />
              <select
                style={selectStyle}
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              >
                <option value="">Select timeframe...</option>
                <option value="Actively looking">Actively looking</option>
                <option value="Within 1 month">Within 1 month</option>
                <option value="1-3 months">1-3 months</option>
                <option value="3-6 months">3-6 months</option>
                <option value="6-12 months">6-12 months</option>
                <option value="Exploring options">Exploring options</option>
              </select>
            </div>
          </div>

          {/* Section 3: Resume */}
          <div>
            <span style={sectionLabel}>Resume</span>
            <div style={{
              display: "inline-flex", border: `0.5px solid ${BORDER}`,
              borderRadius: 8, overflow: "hidden", marginBottom: 14,
            }}>
              {(["paste", "upload"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setResumeTab(tab)}
                  style={{
                    padding: "7px 16px", fontSize: 12, border: "none",
                    background: resumeTab === tab ? PLUM : "#ffffff",
                    color: resumeTab === tab ? "#ffffff" : MUTED,
                    cursor: resumeTab === tab ? "default" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {tab === "paste" ? "Paste Text" : "Upload PDF"}
                </button>
              ))}
            </div>

            {resumeTab === "paste" && (
              <textarea
                style={textareaStyle(140)}
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                placeholder="Paste the client's resume text here..."
              />
            )}

            {resumeTab === "upload" && (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleUpload(f)
                  }}
                />
                <div
                  onClick={() => fileRef.current?.click()}
                  style={{
                    border: `1.5px dashed ${BORDER}`, borderRadius: 8,
                    padding: 32, textAlign: "center", cursor: "pointer",
                  }}
                >
                  {uploading ? (
                    <div style={{ fontSize: 13, color: MUTED }}>Extracting resume...</div>
                  ) : uploadStatus === "Resume extracted" ? (
                    <div style={{ fontSize: 13, color: SUCCESS, fontWeight: 600 }}>Resume extracted &#10003;</div>
                  ) : (
                    <>
                      <div style={{ fontSize: 13, color: MUTED }}>Click to upload or drag and drop</div>
                      <div style={{ fontSize: 11, color: SUBTLE, marginTop: 4 }}>PDF, DOCX, or TXT &middot; max 5MB</div>
                    </>
                  )}
                </div>
                {uploadStatus && uploadStatus !== "Resume extracted" && !uploading && (
                  <div style={{ fontSize: 12, color: ROSE, marginTop: 4 }}>{uploadStatus}</div>
                )}
              </div>
            )}
          </div>

          {/* Section 4: Coaching Notes */}
          <div>
            <span style={sectionLabel}>Coaching Notes</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <textarea
                style={textareaStyle(72)}
                value={hardConstraints}
                onChange={(e) => setHardConstraints(e.target.value)}
                placeholder="Any roles, locations, or companies to avoid?"
              />
              <textarea
                style={textareaStyle(72)}
                value={strengths}
                onChange={(e) => setStrengths(e.target.value)}
                placeholder="What does this client do well?"
              />
              <textarea
                style={textareaStyle(72)}
                value={concerns}
                onChange={(e) => setConcerns(e.target.value)}
                placeholder="What are the gaps or challenges to address?"
              />
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "20px 32px",
          borderTop: `0.5px solid ${BORDER}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          position: "sticky", bottom: 0, background: "#ffffff",
        }}>
          <div>
            {result?.ok && result.emailSent !== false && (
              <span style={{ fontSize: 12, color: SUCCESS, fontStyle: "italic" }}>
                Account created &middot; invite sent
              </span>
            )}
            {result?.ok && result.emailSent === false && (
              <span style={{ fontSize: 12, color: WARN }}>
                Account created but invite failed — contact client directly
              </span>
            )}
            {generalError && !result && (
              <span style={{ fontSize: 12, color: ROSE }}>{generalError}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button
              onClick={handleClose}
              style={{
                fontSize: 13, color: MUTED,
                background: "none", border: "none", cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !!result}
              style={{
                background: PLUM, color: "#ffffff", borderRadius: 24,
                padding: "10px 24px", fontSize: 12, letterSpacing: "0.06em",
                border: "none", cursor: submitting || result ? "default" : "pointer",
                opacity: submitting || result ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              {submitting ? "Creating account..." : "Create Account & Send Invite \u2192"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
