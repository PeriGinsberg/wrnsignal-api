"use client"

import { useEffect, useState, useCallback } from "react"
import { getSupabaseBrowser } from "../../lib/supabase-browser"
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
} from "../../lib/dashboard-theme"

type CoachRecommendation = {
  id: string
  company: string
  title: string
  priority: "urgent" | "high" | "normal" | null
  coaching_note: string | null
  verdict: string | null
  apply_by: string | null
  seen: boolean
  responded: string | null
}

type Profile = {
  id: string
  name: string | null
  email: string | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  preferred_locations: string | null
  timeline: string | null
  resume_text: string | null
  profile_version: number
  profile_structured: Record<string, any> | null
  profile_complete: boolean
  active: boolean | null
  purchase_date: string | null
  refunded_at: string | null
}

const REFUND_WINDOW_DAYS = 7
const REFUND_WINDOW_MS = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000

type Persona = {
  id: string
  name: string
  resume_text: string
  is_default: boolean
  display_order: number
  persona_version: number
}

const PROFILE_FIELDS: { key: keyof Profile; label: string; multi: boolean; required: boolean }[] = [
  { key: "name", label: "NAME", multi: false, required: true },
  { key: "job_type", label: "JOB TYPE", multi: false, required: true },
  { key: "target_roles", label: "TARGET ROLES", multi: false, required: true },
  { key: "target_locations", label: "TARGET LOCATIONS", multi: false, required: false },
  { key: "preferred_locations", label: "PREFERRED LOCATIONS", multi: false, required: false },
  { key: "timeline", label: "TIMELINE", multi: false, required: false },
]

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        padding: "12px 20px",
        borderRadius: 12,
        background: T.SUCCESS_BG,
        border: "1px solid rgba(74,222,128,0.25)",
        color: T.SUCCESS,
        fontSize: 13,
        fontWeight: 900,
        zIndex: 100,
      }}
    >
      {message}
    </div>
  )
}

function SummaryRow({ label: lbl, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM }}>{lbl}</span>
      <p style={{ fontSize: 13, color: T.TEXT, marginTop: 2, lineHeight: "18px" }}>{value}</p>
    </div>
  )
}

const PRIORITY_STYLE: Record<string, { bg: string; color: string }> = {
  urgent: { bg: "rgba(248,113,113,0.15)", color: "#f87171" },
  high: { bg: "rgba(254,176,106,0.15)", color: "#FEB06A" },
  normal: { bg: "rgba(81,173,229,0.12)", color: "#51ADE5" },
}

const DECISION_STYLE: Record<string, { bg: string; color: string }> = {
  "Priority Apply": { bg: "rgba(15,214,104,0.15)", color: "#0FD668" },
  Apply: { bg: "rgba(74,222,128,0.12)", color: "#4ade80" },
  Review: { bg: "rgba(212,164,68,0.15)", color: "#D4A444" },
  Pass: { bg: "rgba(232,112,112,0.12)", color: "#E87070" },
}

const RESPOND_OPTIONS = [
  { value: "interested", label: "Interested" },
  { value: "applying", label: "Applying" },
  { value: "applied", label: "Applied" },
  { value: "not_for_me", label: "Not for me" },
]

export default function DashboardPage() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [personas, setPersonas] = useState<Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Coach state
  const [coachNotifUnseen, setCoachNotifUnseen] = useState(0)
  const [coachRecs, setCoachRecs] = useState<CoachRecommendation[]>([])
  const [respondingId, setRespondingId] = useState<string | null>(null)

  // UI state
  const [profileEditOpen, setProfileEditOpen] = useState(false)
  const [editProfile, setEditProfile] = useState<Profile | null>(null)
  // Persona self-service state was removed for the Cohort 1 pilot
  // (decision 2026-05-07). Personas display read-only here; coaches
  // manage them on the coach client view. Restore from git history when
  // re-enabling client self-service.
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [resumeUploading, setResumeUploading] = useState(false)
  const [showWelcome, setShowWelcome] = useState(false)
  const [refunding, setRefunding] = useState(false)

  async function getToken() {
    const { data: { session } } = await getSupabaseBrowser().auth.getSession()
    if (session?.access_token) return session.access_token
    // Fallback: handoff token stored directly from Framer redirect
    return sessionStorage.getItem("signal_handoff_token")
  }

  async function handleResumeUpload(onText: (text: string) => void) {
    const fileInput = document.createElement("input")
    fileInput.type = "file"
    fileInput.accept = ".pdf,.docx,.doc,.txt"
    fileInput.onchange = async () => {
      const file = fileInput.files?.[0]
      if (!file) return
      const token = await getToken()
      if (!token) return
      setResumeUploading(true)
      try {
        const formData = new FormData()
        formData.append("file", file)
        const res = await fetch("/api/resume-upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || "Upload failed")
        onText(data.text)
        setToast("Resume uploaded successfully")
      } catch (err: any) {
        setToast(err?.message || "Upload failed. Try pasting instead.")
      } finally {
        setResumeUploading(false)
      }
    }
    fileInput.click()
  }

  const loadAll = useCallback(async () => {
    const token = await getToken()
    if (!token) return
    const headers = { Authorization: `Bearer ${token}` }
    const [pRes, personasRes, notifRes] = await Promise.all([
      fetch("/api/profile", { headers }),
      fetch("/api/personas", { headers }),
      fetch("/api/coach/notifications", { headers }),
    ])
    if (pRes.ok) {
      const j = await pRes.json()
      setProfile(j.profile)
    } else {
      setError("Failed to load profile")
    }
    if (personasRes.ok) {
      const j = await personasRes.json()
      setPersonas(j.personas || [])
    }
    if (notifRes.ok) {
      const j = await notifRes.json()
      setCoachNotifUnseen(j.total_unseen || 0)
      setCoachRecs(j.recommendations || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // Show welcome modal only when profile_complete is explicitly false.
  // profile_complete is the sole gate — no localStorage dependency.
  useEffect(() => {
    if (!profile) return
    if (profile.profile_complete !== false) return
    setShowWelcome(true)
  }, [profile])

  // --- Profile actions ---
  function openProfileEdit() {
    setEditProfile(profile ? { ...profile } : null)
    setProfileEditOpen(true)
  }

  async function saveProfile() {
    if (!editProfile) return
    setSaving(true)
    const token = await getToken()
    if (!token) { setSaving(false); return }
    const { id, email, profile_version, profile_structured, ...fields } = editProfile
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const j = await res.json()
      setProfile(j.profile)
      setProfileEditOpen(false)
      setToast("Profile updated")
    }
    setSaving(false)
  }

  // Persona mutation actions were removed for the Cohort 1 pilot
  // (decision 2026-05-07). Personas now display read-only on this page;
  // coaches manage them via /dashboard/coach/clients/[id] (Profile &
  // Personas tab). Restore from git history when re-enabling client
  // self-service.

  async function requestRefund() {
    if (refunding) return
    const ok = window.confirm(
      "Are you sure? You will lose access immediately."
    )
    if (!ok) return

    setRefunding(true)
    try {
      const token = await getToken()
      if (!token) {
        setError("You must be signed in to request a refund.")
        return
      }
      const res = await fetch("/api/stripe/refund", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error || "Refund request failed.")
        return
      }
      // Sign the user out and return them to the unauthenticated state.
      try {
        await getSupabaseBrowser().auth.signOut()
      } catch {
        // ignore — we're redirecting regardless
      }
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("signal_handoff_token")
        window.location.href = "/dashboard"
      }
    } finally {
      setRefunding(false)
    }
  }

  async function respondToRec(recId: string, response: string) {
    setRespondingId(recId)
    const token = await getToken()
    if (!token) { setRespondingId(null); return }
    await fetch(`/api/coach/recommendations/${recId}/respond`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ response }),
    })
    setCoachRecs((prev) => prev.map((r) => r.id === recId ? { ...r, responded: response } : r))
    if (coachNotifUnseen > 0) setCoachNotifUnseen((n) => n - 1)
    setRespondingId(null)
  }

  if (loading) return <p style={{ color: T.MUTED, fontSize: 13 }}>Loading...</p>
  if (error && !profile) return <p style={{ color: T.ERROR, fontSize: 13 }}>{error}</p>

  // atLimit removed — pilot disables client-side persona create.

  return (
    <div>
      {/* Welcome modal for first-time users */}
      {showWelcome && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            background: "#0D1F35",
            border: "0.5px solid #1E3A5F",
            borderRadius: 16,
            padding: 40,
            maxWidth: 480,
            width: "90%",
          }}>
            <h2 style={{
              color: "#ffffff", fontSize: 24, fontWeight: 900,
              fontStyle: "italic", margin: 0,
            }}>
              Welcome to SIGNAL.
            </h2>
            <p style={{
              color: "#7A99BA", fontSize: 14, lineHeight: "1.75",
              marginTop: 16, marginBottom: 0,
            }}>
              Before we can score any job for you, we need to know you. It takes about 3 minutes
              — upload your resume, tell us your targets, and set your constraints. Everything
              SIGNAL does from here runs on this profile.
            </p>
            <button
              onClick={() => setShowWelcome(false)}
              style={{
                width: "100%", marginTop: 28, padding: 16,
                background: "linear-gradient(90deg, #FF6B00, #FF9A3C)",
                color: "#ffffff", fontWeight: 900, fontStyle: "italic",
                fontSize: 16, borderRadius: 12, border: "none",
                cursor: "pointer",
              }}
            >
              Build my profile
            </button>
          </div>
        </div>
      )}

      {/* Coach notification banner */}
      {coachNotifUnseen > 0 && (
        <div style={{
          background: "rgba(254,176,106,0.09)",
          border: "1px solid rgba(254,176,106,0.25)",
          borderRadius: 14,
          padding: "14px 20px",
          marginBottom: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{
              background: T.WRN_ORANGE, color: "#04060F", fontWeight: 900,
              fontSize: 11, padding: "2px 8px", borderRadius: 999,
            }}>
              {coachNotifUnseen}
            </span>
            <span style={{ fontSize: 14, fontWeight: 900, color: T.TEXT }}>
              New recommendation{coachNotifUnseen !== 1 ? "s" : ""} from your coach
            </span>
          </div>
          <span style={{ fontSize: 12, color: T.WRN_ORANGE, fontWeight: 700 }}>↓ See below</span>
        </div>
      )}

      <div style={{ ...eyebrow, color: T.DIM, marginBottom: 8 }}>CONTROL CENTER</div>
      <h1 style={{ ...headline, fontSize: 32, letterSpacing: -1 }}>
        Welcome{profile?.name ? `, ${profile.name}` : ""}
      </h1>
      <p style={{ fontSize: 13, color: T.MUTED, marginTop: 4 }}>{profile?.email}</p>

      {/* From Your Coach section */}
      {coachRecs.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 14 }}>FROM YOUR COACH</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {coachRecs.map((rec) => (
              <div key={rec.id} style={{
                ...card,
                border: rec.responded ? `1px solid ${T.BORDER_SOFT}` : "1px solid rgba(254,176,106,0.22)",
                opacity: rec.responded ? 0.8 : 1,
              }}>
                <div style={{ height: 3, background: rec.responded ? "rgba(255,255,255,0.06)" : "linear-gradient(90deg,#FEB06A,#f97316)" }} />
                <div style={{ padding: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontSize: 15, fontWeight: 950, color: T.TEXT }}>{rec.company}</span>
                    <span style={{ fontSize: 13, color: T.MUTED }}>— {rec.title}</span>
                    {rec.priority && (
                      <span style={{
                        ...(PRIORITY_STYLE[rec.priority] || PRIORITY_STYLE.normal),
                        fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase" as const,
                        padding: "3px 10px", borderRadius: 999,
                        background: (PRIORITY_STYLE[rec.priority] || PRIORITY_STYLE.normal).bg,
                        color: (PRIORITY_STYLE[rec.priority] || PRIORITY_STYLE.normal).color,
                      }}>
                        {rec.priority}
                      </span>
                    )}
                    {rec.verdict && (
                      <span style={{
                        fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: "uppercase" as const,
                        padding: "3px 10px", borderRadius: 999,
                        background: (DECISION_STYLE[rec.verdict] || { bg: "rgba(255,255,255,0.08)", color: T.MUTED }).bg,
                        color: (DECISION_STYLE[rec.verdict] || { bg: "rgba(255,255,255,0.08)", color: T.MUTED }).color,
                      }}>
                        {rec.verdict}
                      </span>
                    )}
                    {rec.apply_by && (
                      <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>
                        Apply by: <span style={{ color: T.WRN_ORANGE, fontWeight: 700 }}>{rec.apply_by}</span>
                      </span>
                    )}
                  </div>

                  {rec.coaching_note && (
                    <p style={{ fontSize: 13, color: T.MUTED, lineHeight: "19px", marginBottom: 14 }}>
                      <span style={{ color: T.WRN_ORANGE, fontWeight: 900 }}>Coach: </span>
                      {rec.coaching_note}
                    </p>
                  )}

                  {/* Response pills */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const, alignItems: "center" }}>
                    {rec.responded ? (
                      <span style={{ fontSize: 11, color: T.DIM }}>
                        You responded: <span style={{ color: T.SUCCESS, fontWeight: 900 }}>
                          {RESPOND_OPTIONS.find((o) => o.value === rec.responded)?.label || rec.responded}
                        </span>
                      </span>
                    ) : (
                      <>
                        <span style={{ fontSize: 11, color: T.DIM, marginRight: 4 }}>Your status:</span>
                        {RESPOND_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => respondToRec(rec.id, opt.value)}
                            disabled={respondingId === rec.id}
                            style={{
                              fontSize: 11, fontWeight: 900, padding: "5px 14px", borderRadius: 999, cursor: "pointer",
                              border: `1px solid ${T.BORDER_SOFT}`,
                              background: "rgba(255,255,255,0.04)",
                              color: T.MUTED,
                              opacity: respondingId === rec.id ? 0.5 : 1,
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "rgba(254,176,106,0.1)"
                              e.currentTarget.style.color = T.WRN_ORANGE
                              e.currentTarget.style.borderColor = "rgba(254,176,106,0.3)"
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "rgba(255,255,255,0.04)"
                              e.currentTarget.style.color = T.MUTED
                              e.currentTarget.style.borderColor = T.BORDER_SOFT
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 24, marginTop: 28, alignItems: "flex-start" }}>
        {/* LEFT COLUMN — Profile */}
        <div style={{ width: "40%", flexShrink: 0 }}>
          <div style={{ ...eyebrow, color: T.WRN_BLUE, marginBottom: 10 }}>PROFILE</div>
          <div style={card}>
            <div style={{ height: 3, background: T.GRAD_PROFILE }} />
            <div style={{ padding: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 18, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>
                  {profile?.name || "Unnamed"}
                </span>
                <span style={{ fontSize: 11, color: T.DIM }}>Version {profile?.profile_version}</span>
              </div>

              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                {profile?.target_roles && <SummaryRow label="Target Roles" value={profile.target_roles} />}
                {profile?.target_locations && <SummaryRow label="Locations" value={profile.target_locations} />}
                {profile?.preferred_locations && <SummaryRow label="Preferred Locations" value={profile.preferred_locations} />}
                {profile?.job_type && <SummaryRow label="Job Type" value={profile.job_type} />}
                {profile?.timeline && <SummaryRow label="Timeline" value={profile.timeline} />}
                {profile?.resume_text && <SummaryRow label="Resume" value={profile.resume_text.length > 200 ? profile.resume_text.slice(0, 200) + "..." : profile.resume_text} />}
              </div>

              {!profileEditOpen && (
                <button onClick={openProfileEdit} style={{ ...btnSecondary, marginTop: 20, fontSize: 12, padding: "9px 16px", borderRadius: 10, color: T.WRN_ORANGE, borderColor: "rgba(254,176,106,0.3)" }}>
                  Edit Profile
                </button>
              )}
            </div>

            {/* Profile edit form */}
            {profileEditOpen && editProfile && (
              <div style={{ borderTop: `1px solid ${T.BORDER_SOFT}`, padding: 24 }}>
                <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 16 }}>EDIT PROFILE</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {PROFILE_FIELDS.map(({ key, label: lbl, multi, required: req }) => (
                    <div key={key}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <span style={{ ...label, color: req ? T.WRN_BLUE : T.DIM }}>{lbl}</span>
                        {!req && <span style={{ fontSize: 9, color: T.DIM }}>optional</span>}
                      </div>
                      {key === "job_type" ? (
                        <select
                          style={{ ...input, cursor: "pointer", colorScheme: "dark" }}
                          value={(editProfile[key] as string) ?? ""}
                          onChange={(e) => setEditProfile({ ...editProfile, [key]: e.target.value })}
                        >
                          <option value="" disabled style={{ background: "#0a1628", color: "#E8E6E1" }}>Select job type</option>
                          <option value="Full Time" style={{ background: "#0a1628", color: "#E8E6E1" }}>Full Time</option>
                          <option value="Internship" style={{ background: "#0a1628", color: "#E8E6E1" }}>Internship</option>
                          <option value="Both" style={{ background: "#0a1628", color: "#E8E6E1" }}>Both</option>
                        </select>
                      ) : multi ? (
                        <textarea
                          style={{ ...textarea, minHeight: 100 }}
                          value={(editProfile[key] as string) ?? ""}
                          onChange={(e) => setEditProfile({ ...editProfile, [key]: e.target.value })}
                        />
                      ) : (
                        <input
                          type="text"
                          style={input}
                          value={(editProfile[key] as string) ?? ""}
                          onChange={(e) => setEditProfile({ ...editProfile, [key]: e.target.value })}
                        />
                      )}
                      {key === "timeline" && (
                        <span style={{ display: "block", marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                          e.g. Immediate, Summer 2026, Fall 2026, Spring 2027, Summer 2027
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                  <button onClick={saveProfile} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.5 : 1 }}>
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button onClick={() => setProfileEditOpen(false)} style={{ ...btnSecondary, fontSize: 13 }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN — Personas (read-only during pilot) */}
        <div style={{ flex: 1 }}>
          <div style={{ ...eyebrow, color: T.WRN_ORANGE, marginBottom: 10 }}>PERSONAS</div>
          <p style={{ fontSize: 12, color: T.DIM, marginBottom: 14, lineHeight: "18px" }}>
            Your coach manages your personas during the pilot.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {personas.map((p) => (
              <div key={p.id} style={card}>
                <div style={{ height: 3, background: T.GRAD_PERSONA }} />
                <div style={{ padding: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 18, fontWeight: 950, letterSpacing: -0.3, color: T.TEXT }}>{p.name}</span>
                    {p.is_default && (
                      <span style={{
                        fontSize: 9, fontWeight: 900, letterSpacing: 1.5, textTransform: "uppercase",
                        color: T.WRN_ORANGE, background: T.WARNING_BG, padding: "3px 8px", borderRadius: 6,
                      }}>
                        Default
                      </span>
                    )}
                    <span style={{ fontSize: 11, color: T.DIM, marginLeft: "auto" }}>Version {p.persona_version}</span>
                  </div>
                  <p style={{ fontSize: 13, color: T.MUTED, marginTop: 10, lineHeight: "20px" }}>
                    {p.resume_text
                      ? p.resume_text.slice(0, 200) + (p.resume_text.length > 200 ? "..." : "")
                      : "No resume text yet"}
                  </p>
                </div>
              </div>
            ))}

            {personas.length === 0 && (
              <p style={{ color: T.MUTED, fontSize: 13 }}>No personas yet — your coach will set one up.</p>
            )}
          </div>
        </div>
      </div>

      {(() => {
        if (!profile?.purchase_date) return null
        if (profile.refunded_at) return null
        if (profile.active === false) return null
        const purchasedAt = new Date(profile.purchase_date).getTime()
        if (!Number.isFinite(purchasedAt)) return null
        const ageMs = Date.now() - purchasedAt
        if (ageMs > REFUND_WINDOW_MS) return null
        const daysLeft = Math.max(
          0,
          Math.ceil((REFUND_WINDOW_MS - ageMs) / (24 * 60 * 60 * 1000))
        )
        return (
          <div style={{ marginTop: 40 }}>
            <div style={{ ...eyebrow, color: T.DIM, marginBottom: 10 }}>ACCOUNT</div>
            <div style={{ ...card }}>
              <div style={{ padding: 20, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 900, color: T.TEXT, marginBottom: 4 }}>
                    7-day money-back guarantee
                  </div>
                  <div style={{ fontSize: 12, color: T.MUTED, lineHeight: "18px" }}>
                    You have {daysLeft} day{daysLeft === 1 ? "" : "s"} left to request a
                    full refund. Refunding will revoke your SIGNAL access immediately.
                  </div>
                </div>
                <button
                  onClick={requestRefund}
                  disabled={refunding}
                  style={{
                    ...btnSecondary,
                    fontSize: 12,
                    padding: "10px 16px",
                    borderRadius: 10,
                    color: "#f87171",
                    borderColor: "rgba(248,113,113,0.3)",
                    opacity: refunding ? 0.5 : 1,
                  }}
                >
                  {refunding ? "Processing..." : "Request Refund"}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  )
}
