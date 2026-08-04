"use client"

// "Add a job" — the manual entry path, for a job the student did not score.
//
// CUT from the old form: interest stars (the build plan cuts them outright),
// date posted (a fact about the posting, not about the student's pursuit, and
// nobody filled it in), and persona (it belongs with the resume, on My Profile).
// Persona is still editable on the detail page, so nothing became unreachable.
//
// What is left is what a student actually knows at the moment they add a job:
// where it is, what it is, and whether they have sent it yet.

import { useState } from "react"
import { LIGHT as S, action as actionStyle, surfaceCard } from "../../../lib/theme/surfaces"
import { authFetch } from "../network/authFetch"
import { Field, Select, control, areaControl, formGrid } from "./controls"
import { APP_LOCATIONS, STATUS_LABELS } from "./vocab"

const STATUS_OPTIONS = ["saved", "applied"].map((v) => ({ value: v, label: STATUS_LABELS[v] }))

export function AddJobForm({
  onClose, onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [location, setLocation] = useState("")
  const [url, setUrl] = useState("")
  const [source, setSource] = useState<string>(APP_LOCATIONS[0])
  const [status, setStatus] = useState("saved")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ready = company.trim().length > 0 && title.trim().length > 0

  async function submit() {
    if (!ready || saving) return
    setSaving(true); setErr(null)
    try {
      const res = await authFetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_name: company.trim(),
          job_title: title.trim(),
          location: location.trim() || null,
          job_url: url.trim() || null,
          application_location: source,
          application_status: status,
          // A job added as already-applied is applied TODAY unless the student
          // edits it. Leaving this null would make it invisible to the
          // follow-up rule, which reads applied_date first.
          applied_date: status === "applied" ? new Date().toISOString().slice(0, 10) : null,
          notes: notes.trim() || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not add the job (${res.status})`)
      onCreated()
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      style={{ ...surfaceCard(S, true), borderRadius: 14, padding: "20px 22px", marginBottom: 14 }}
    >
      <div
        style={{
          fontSize: 12, fontWeight: 800, letterSpacing: 1.4,
          textTransform: "uppercase", color: S.text.muted, marginBottom: 16,
        }}
      >
        Add a job
      </div>

      <div style={formGrid}>
        <Field label="Company">
          <input
            style={control} value={company} onChange={(e) => setCompany(e.target.value)}
            placeholder="Where is it" maxLength={200} aria-label="Company"
          />
        </Field>
        <Field label="Role">
          <input
            style={control} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="What is the job" maxLength={200} aria-label="Role"
          />
        </Field>
        <Field label="Location">
          <input
            style={control} value={location} onChange={(e) => setLocation(e.target.value)}
            placeholder="City, or remote" aria-label="Location"
          />
        </Field>
        <Field label="Link to the posting">
          <input
            style={control} value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://" aria-label="Link to the posting"
          />
        </Field>
        <Field label="Where you found it">
          <Select value={source} options={APP_LOCATIONS} onChange={setSource} ariaLabel="Where you found it" />
        </Field>
        <Field label="Have you applied yet">
          <Select value={status} options={STATUS_OPTIONS} onChange={setStatus} ariaLabel="Have you applied yet" />
        </Field>
        <Field label="Notes" span={2}>
          <textarea
            style={areaControl} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything you want to remember about this one" aria-label="Notes"
          />
        </Field>
      </div>

      {err && <div style={{ color: S.meaning.error.ink, fontSize: 13, marginTop: 12 }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
        <button
          onClick={submit}
          disabled={!ready || saving}
          style={{
            ...actionStyle(S, "primary"),
            borderRadius: 10, padding: "11px 20px", fontSize: 14.5, fontFamily: "inherit",
            // Not disabled-looking until it is actually unusable: the button
            // stays peach and simply will not fire while the two required
            // fields are empty, and dims only to say "not yet".
            opacity: ready ? 1 : 0.45,
            cursor: ready && !saving ? "pointer" : "default",
          }}
        >
          {saving ? "Adding…" : "Add this job"}
        </button>
        <button
          onClick={onClose}
          style={{
            background: "none", border: "none", color: S.action.quietInk,
            fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
      </div>
    </section>
  )
}
