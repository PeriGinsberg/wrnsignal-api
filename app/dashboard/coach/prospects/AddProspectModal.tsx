"use client"

// Capture modal for Prospects v0.1 Commit 4c (FRD §6.4.2 POST shape).
// Rendered as a child of the List page when "+ Add Prospect" is clicked.
// On submit, POSTs to /api/coach/prospects and calls onSuccess() on 201.
//
// Visual pattern: dark backdrop + T.CARD modal, matches the inline
// InviteModal on Coach Home (NOT the light/plum CreateClientModal,
// which is heavier scope).
//
// Validation gates:
//   - name required + trim>0 (client-side disable on empty)
//   - lead source required (lib/prospects/model.ts LEAD_SOURCES); Other asks
//     to specify, and a friend/family or past-client source offers
//     "Referred by" (name, optional email)
//   - email, parent or guardian contact, and the note: optional
// Server validation is authoritative.
// Server validation is authoritative; client-side errors are
// translated by mapServerErrorToField.

import { useState } from "react"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import {
  T,
  input,
  textarea,
  btnPrimary,
  btnSecondary,
  card,
  eyebrow,
  label,
  selectDarkInk,
  selectDarkOption,
} from "../../../../lib/dashboard-theme"
import { SavingSpinner } from "../SavingSpinner"
import {
  LeadSourceFields,
  ParentFields,
  leadSourcePayload,
  type LeadSourceValue,
  type ParentValue,
} from "../_prospects/leadSourceUi"

// Education status (v0.2). University + Grad date reveal only for in_school /
// graduated (not for "na"). Values match the coach_clients CHECK enum.
const EDUCATION_OPTIONS: { value: "in_school" | "graduated" | "na"; label: string }[] = [
  { value: "in_school", label: "In school" },
  { value: "graduated", label: "Graduated" },
  { value: "na", label: "Not applicable" },
]

// ── Auth helpers (inline per established convention) ──

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

type Props = {
  onClose: () => void
  onSuccess: () => void
}

type FieldErrors = Partial<{
  name: string
  source_category: string
  invited_email: string
  phone: string
  source_detail: string
  initial_note: string
  linkedin_url: string
  target_roles: string
  education_status: string
  university: string
  grad_date: string
}>

export default function AddProspectModal({ onClose, onSuccess }: Props) {
  const [name, setName] = useState("")
  const [lead, setLead] = useState<LeadSourceValue>({ source_category: "", source_detail: "", referred_by_name: "", referred_by_email: "" })
  const [parent, setParent] = useState<ParentValue>({ parent_name: "", parent_email: "", parent_phone: "" })
  const [showParent, setShowParent] = useState(false)
  const [invitedEmail, setInvitedEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [initialNote, setInitialNote] = useState("")
  // v0.2 "add details" expander fields.
  const [expanded, setExpanded] = useState(false)
  const [linkedinUrl, setLinkedinUrl] = useState("")
  const [targetRoles, setTargetRoles] = useState("")
  const [educationStatus, setEducationStatus] = useState<"" | "in_school" | "graduated" | "na">("")
  const [university, setUniversity] = useState("")
  const [gradDate, setGradDate] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [generalError, setGeneralError] = useState<string | null>(null)

  // University + Grad date only matter when the prospect is in school / a grad.
  const showEducationDetails = educationStatus === "in_school" || educationStatus === "graduated"

  const nameValid = name.trim().length > 0
  const sourceCategoryValid = lead.source_category !== "" && (lead.source_category !== "other" || lead.source_detail.trim() !== "")
  const canSubmit = nameValid && sourceCategoryValid && !submitting

  function mapServerErrorToField(serverMsg: string) {
    // 4b returns string error messages. Map known shapes to fields;
    // fall through to generalError for anything unrecognized.
    if (/name is required|name cannot be empty/i.test(serverMsg)) {
      setErrors({ name: serverMsg })
    } else if (/source_category/i.test(serverMsg)) {
      setErrors({ source_category: serverMsg })
    } else if (/source_detail|referred_by|parent_/i.test(serverMsg)) {
      setErrors({ source_category: serverMsg })
    } else if (/initial_note/i.test(serverMsg)) {
      setErrors({ initial_note: serverMsg })
    } else if (/invited_email|email/i.test(serverMsg)) {
      setErrors({ invited_email: serverMsg })
    } else if (/phone/i.test(serverMsg)) {
      setErrors({ phone: serverMsg })
    } else if (/linkedin_url/i.test(serverMsg)) {
      setErrors({ linkedin_url: serverMsg })
    } else if (/target_roles/i.test(serverMsg)) {
      setErrors({ target_roles: serverMsg })
    } else if (/education_status/i.test(serverMsg)) {
      setErrors({ education_status: serverMsg })
    } else if (/grad_date/i.test(serverMsg)) {
      setErrors({ grad_date: serverMsg })
    } else if (/university/i.test(serverMsg)) {
      setErrors({ university: serverMsg })
    } else {
      setGeneralError(serverMsg)
    }
  }

  async function handleSubmit() {
    setErrors({})
    setGeneralError(null)
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const body: Record<string, string | null> = {
        name: name.trim(),
        ...leadSourcePayload(lead),
      }
      for (const [k, v] of Object.entries(parent)) if (v.trim()) body[k] = v.trim()
      const trimmedEmail = invitedEmail.trim()
      if (trimmedEmail) body.invited_email = trimmedEmail
      const trimmedPhone = phone.trim()
      if (trimmedPhone) body.phone = trimmedPhone
      const trimmedNote = initialNote.trim()
      if (trimmedNote) body.initial_note = trimmedNote
      // v0.2 expander fields (only sent when filled).
      const trimmedLinkedin = linkedinUrl.trim()
      if (trimmedLinkedin) body.linkedin_url = trimmedLinkedin
      const trimmedTargetRoles = targetRoles.trim()
      if (trimmedTargetRoles) body.target_roles = trimmedTargetRoles
      if (educationStatus) body.education_status = educationStatus
      // University + grad date only carry meaning with an education status.
      if (showEducationDetails) {
        const trimmedUni = university.trim()
        if (trimmedUni) body.university = trimmedUni
        if (gradDate) body.grad_date = gradDate
      }

      const res = await authFetch("/api/coach/prospects", {
        method: "POST",
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (res.status === 201) {
        onSuccess()
        return
      }
      if (res.status === 400 && typeof j?.error === "string") {
        mapServerErrorToField(j.error)
        return
      }
      setGeneralError(j?.error || "Couldn't add prospect — try again")
    } catch {
      setGeneralError("Network error — try again")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.75)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div style={{ ...card, padding: 36, width: 480, maxWidth: "90vw", maxHeight: "92vh", overflowY: "auto" }}>
        <div
          style={{
            height: 3,
            background: T.GRAD_PRIMARY,
            margin: "-36px -36px 28px",
            borderRadius: "18px 18px 0 0",
          }}
        />
        <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 18 }}>ADD A PROSPECT</div>

        {/* Form fields wrapper — dims during submit (matches Coach
            Home InviteModal + ClientDetail annotate pattern). */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            opacity: submitting ? 0.5 : 1,
            pointerEvents: submitting ? "none" : "auto",
            transition: "opacity 120ms ease",
          }}
        >
          {/* Name */}
          <div>
            <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>NAME</span>
            <input
              type="text"
              style={input}
              placeholder="e.g. Jordan Smith"
              value={name}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }) }}
              autoFocus
            />
            {errors.name && (
              <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.name}</div>
            )}
          </div>

          {/* Email (optional) */}
          <div>
            <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
              EMAIL <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
            </span>
            <input
              type="email"
              style={input}
              placeholder="student@example.com"
              value={invitedEmail}
              onChange={(e) => { setInvitedEmail(e.target.value); if (errors.invited_email) setErrors({ ...errors, invited_email: undefined }) }}
            />
            <p style={{ fontSize: 11, color: T.DIM, marginTop: 4 }}>The student&apos;s email. Used later when you send a SIGNAL invite.</p>
            {errors.invited_email && (
              <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.invited_email}</div>
            )}
          </div>

          {/* Lead source, Other: specify, and Referred by */}
          <LeadSourceFields
            idPrefix="add-prospect"
            value={lead}
            onChange={(next) => { setLead(next); if (errors.source_category) setErrors({ ...errors, source_category: undefined }) }}
            error={errors.source_category}
          />

          {/* Parent or guardian (optional) */}
          {showParent ? (
            <ParentFields idPrefix="add-prospect" value={parent} onChange={setParent} />
          ) : (
            <button
              type="button"
              onClick={() => setShowParent(true)}
              style={{ alignSelf: "flex-start", background: "none", border: "none", color: T.INK_LINK, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", padding: 0 }}
            >
              + Add a parent or guardian
            </button>
          )}

          {/* Note (optional) */}
          <div>
            <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
              NOTE <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
            </span>
            <textarea
              style={{ ...textarea, minHeight: 80 }}
              placeholder="Anything to remember about this prospect..."
              value={initialNote}
              onChange={(e) => { setInitialNote(e.target.value); if (errors.initial_note) setErrors({ ...errors, initial_note: undefined }) }}
              maxLength={5000}
            />
            {errors.initial_note && (
              <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.initial_note}</div>
            )}
          </div>

          {/* "Add details" expander toggle. Required floor stays Name + Source;
              everything else is optional and tucked behind this. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            style={{
              alignSelf: "flex-start",
              background: "none",
              border: "none",
              color: T.INK_LINK,
              fontSize: 12,
              fontWeight: 800,
              cursor: "pointer",
              fontFamily: "inherit",
              padding: 0,
            }}
          >
            {expanded ? "− Hide details" : "+ Add details"}
          </button>

          {expanded && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              {/* Phone number (optional) */}
              <div>
                <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
                  PHONE NUMBER <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
                </span>
                <input
                  type="tel"
                  style={input}
                  placeholder="(555) 555-5555"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); if (errors.phone) setErrors({ ...errors, phone: undefined }) }}
                />
                {errors.phone && (
                  <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.phone}</div>
                )}
              </div>

              {/* LinkedIn (optional) */}
              <div>
                <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
                  LINKEDIN <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
                </span>
                <input
                  type="url"
                  style={input}
                  placeholder="https://linkedin.com/in/..."
                  value={linkedinUrl}
                  onChange={(e) => { setLinkedinUrl(e.target.value); if (errors.linkedin_url) setErrors({ ...errors, linkedin_url: undefined }) }}
                />
                {errors.linkedin_url && (
                  <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.linkedin_url}</div>
                )}
              </div>

              {/* Target roles (optional) */}
              <div>
                <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
                  TARGET ROLES <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
                </span>
                <input
                  type="text"
                  style={input}
                  placeholder="e.g. Product Manager, Strategy"
                  value={targetRoles}
                  onChange={(e) => { setTargetRoles(e.target.value); if (errors.target_roles) setErrors({ ...errors, target_roles: undefined }) }}
                />
                {errors.target_roles && (
                  <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.target_roles}</div>
                )}
              </div>

              {/* Education status (optional) → conditionally reveals University + Grad date */}
              <div>
                <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
                  EDUCATION STATUS <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
                </span>
                <select
                  style={{ ...input, ...selectDarkInk }}
                  value={educationStatus}
                  onChange={(e) => { setEducationStatus(e.target.value as typeof educationStatus); if (errors.education_status) setErrors({ ...errors, education_status: undefined }) }}
                >
                  <option value="" style={selectDarkOption}>Select…</option>
                  {EDUCATION_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value} style={selectDarkOption}>{o.label}</option>
                  ))}
                </select>
                {errors.education_status && (
                  <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.education_status}</div>
                )}
              </div>

              {showEducationDetails && (
                <>
                  {/* University (optional) */}
                  <div>
                    <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
                      UNIVERSITY <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
                    </span>
                    <input
                      type="text"
                      style={input}
                      placeholder="e.g. State University"
                      value={university}
                      onChange={(e) => { setUniversity(e.target.value); if (errors.university) setErrors({ ...errors, university: undefined }) }}
                    />
                    {errors.university && (
                      <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.university}</div>
                    )}
                  </div>

                  {/* Grad date (optional) — native date input handles empty/partial */}
                  <div>
                    <span style={{ ...label, color: T.INK_LINK, display: "block", marginBottom: 6 }}>
                      GRAD DATE <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span>
                    </span>
                    <input
                      type="date"
                      style={{ ...input, cursor: "pointer", colorScheme: "dark" }}
                      value={gradDate}
                      onChange={(e) => { setGradDate(e.target.value); if (errors.grad_date) setErrors({ ...errors, grad_date: undefined }) }}
                    />
                    {errors.grad_date && (
                      <div style={{ fontSize: 12, color: T.ERROR, marginTop: 4, fontWeight: 700 }}>{errors.grad_date}</div>
                    )}
                  </div>
                </>
              )}

            </div>
          )}
        </div>

        {generalError && (
          <div
            style={{
              marginTop: 18,
              padding: 12,
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.3)",
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 13, color: T.ERROR, fontWeight: 700 }}>{generalError}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 24, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{ ...btnSecondary, fontSize: 13, opacity: submitting ? 0.5 : 1 }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              ...btnPrimary,
              background: "#FEB06A",
              color: "var(--sig-ink-on-bright, #04060F)",
              fontWeight: 900,
              opacity: canSubmit ? 1 : 0.5,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {submitting && <SavingSpinner />}
            {submitting ? "Adding..." : "Add Prospect →"}
          </button>
        </div>
      </div>
    </div>
  )
}
