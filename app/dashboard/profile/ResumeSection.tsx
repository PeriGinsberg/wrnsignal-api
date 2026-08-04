"use client"

// Resume: the master resume, and the variants built from it.
//
// Both halves came from the old /dashboard page via LegacyAccountPanel, which
// this section retires. Nothing was dropped: upload, paste, create, rename,
// edit, set default and delete are all still here.
//
// THE ONE REAL CHANGE is that a persona is now called what it is. "Persona" is
// our word, not a student's; the panel called them personas and then had to
// explain in a paragraph that a persona is a different version of your resume
// for a different kind of role. So the heading says "Resume versions" and the
// word persona does not appear. The API and the column are untouched: this is a
// label, not a rename.
//
// Resume text is a plain textarea rather than a rich editor on purpose. It is
// read by the scoring engine as text, and anything that adds formatting adds
// characters the extractor then has to strip back out.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, action as actionStyle, surfaceCard, tileStructural } from "../../../lib/theme/surfaces"
import { ResumeIcon } from "../../../components/icons"
import { authFetch } from "../network/authFetch"
import { SectionHead, type Profile } from "./BasicsSection"
import { Field, areaControl, control } from "./controls"

type Persona = {
  id: string
  name: string
  resume_text: string | null
  is_default: boolean
}

/** Shared by the master resume and every variant: pick a file, get text back. */
async function uploadResume(onText: (text: string) => void): Promise<string | null> {
  return new Promise((resolve) => {
    const el = document.createElement("input")
    el.type = "file"
    el.accept = ".pdf,.docx,.doc,.txt"
    el.onchange = async () => {
      const file = el.files?.[0]
      if (!file) return resolve(null)
      try {
        const body = new FormData()
        body.append("file", file)
        const res = await authFetch("/api/resume-upload", { method: "POST", body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) return resolve(data?.error || "That file didn't upload. Try pasting instead.")
        onText(data.text)
        resolve(null)
      } catch {
        resolve("That file didn't upload. Try pasting instead.")
      }
    }
    el.click()
  })
}

export function ResumeSection({
  profile, onSave,
}: {
  profile: Profile
  onSave: (patch: Partial<Profile>) => Promise<boolean>
}) {
  const [text, setText] = useState(profile.resume_text ?? "")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const dirty = text !== (profile.resume_text ?? "")

  async function submit() {
    setSaving(true)
    const ok = await onSave({ resume_text: text })
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2600) }
  }

  return (
    <>
      <SectionHead
        title="Resume"
        blurb="The resume SIGNAL reads when it scores a job and writes your outreach. Paste it or upload a file, whichever is easier."
      />

      <Field label="Your resume">
        <textarea
          value={text}
          aria-label="Your resume"
          onChange={(e) => { setText(e.target.value); setSaved(false) }}
          placeholder="Paste the whole thing. Formatting doesn't matter, the words do."
          style={{ ...areaControl, minHeight: 260, fontSize: 14, lineHeight: "21px" }}
        />
      </Field>

      {err && <div style={{ color: S.meaning.error.ink, fontSize: 14, marginBottom: 14 }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <button
          onClick={submit}
          disabled={!dirty || saving}
          style={{
            ...actionStyle(S, "primary"),
            borderRadius: 11, padding: "11px 22px", fontSize: 14.5, fontFamily: "inherit",
            opacity: dirty && !saving ? 1 : 0.45,
            cursor: dirty && !saving ? "pointer" : "default",
          }}
        >
          {saving ? "Saving…" : "Save resume"}
        </button>
        <button
          onClick={async () => {
            setBusy(true); setErr(null)
            const e = await uploadResume((t) => { setText(t); setSaved(false) })
            setErr(e); setBusy(false)
          }}
          disabled={busy}
          style={quietBtn}
        >
          {busy ? "Reading the file…" : "Upload a file instead"}
        </button>
        {saved && <span style={{ color: S.meaning.replied.ink, fontSize: 14, fontWeight: 700 }}>Saved</span>}
      </div>

      <Versions />
    </>
  )
}

/**
 * Resume versions. `client_personas` in the database; never called that here.
 */
function Versions() {
  const [rows, setRows] = useState<Persona[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ name: string; resume_text: string }>({ name: "", resume_text: "" })
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/personas")
      const j = await res.json().catch(() => ({}))
      setRows(j.personas ?? [])
    } catch {
      setRows([])
    }
  }, [])
  useEffect(() => { void load() }, [load])

  async function call(url: string, init: RequestInit, failure: string) {
    setBusy(true); setErr(null)
    try {
      const res = await authFetch(url, init)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setErr(j?.error || failure)
        return false
      }
      await load()
      return true
    } catch {
      setErr(failure)
      return false
    } finally {
      setBusy(false)
    }
  }

  if (rows === null) return null

  return (
    <section style={{ marginTop: 44, paddingTop: 32, borderTop: `1px solid ${S.borderSoft}` }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 800, color: S.text.primary, margin: 0 }}>
            Resume versions
          </h3>
          <p style={{ color: S.text.muted, fontSize: 14.5, lineHeight: "21px", margin: "6px 0 0", maxWidth: 560 }}>
            If you're going after two different kinds of role, keep a version for each. Pick one when
            you score a job and SIGNAL reads that one instead.
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditing(null); setDraft({ name: "", resume_text: "" }) }}
            style={{ ...actionStyle(S, "optional"), borderRadius: 10, padding: "10px 18px", fontSize: 14, fontFamily: "inherit", flexShrink: 0 }}
          >
            + Add a version
          </button>
        )}
      </div>

      {err && <div style={{ color: S.meaning.error.ink, fontSize: 14, marginTop: 14 }}>{err}</div>}

      {adding && (
        <div style={{ ...surfaceCard(S, true), borderRadius: 14, padding: "20px 22px", marginTop: 18 }}>
          <Field label="What to call it">
            <input
              style={control} value={draft.name} autoFocus aria-label="What to call it"
              placeholder="e.g. Data roles"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="The resume for this version">
            <textarea
              style={{ ...areaControl, minHeight: 180, fontSize: 14 }}
              value={draft.resume_text} aria-label="The resume for this version"
              placeholder="Paste the version tailored to these roles."
              onChange={(e) => setDraft({ ...draft, resume_text: e.target.value })}
            />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              disabled={!draft.name.trim() || busy}
              onClick={async () => {
                const ok = await call("/api/personas", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name: draft.name.trim(), resume_text: draft.resume_text }),
                }, "That version didn't save.")
                if (ok) setAdding(false)
              }}
              style={{
                ...actionStyle(S, "primary"), borderRadius: 10, padding: "10px 18px", fontSize: 14,
                fontFamily: "inherit", opacity: draft.name.trim() && !busy ? 1 : 0.45,
              }}
            >
              Save this version
            </button>
            <button onClick={() => setAdding(false)} style={quietBtn}>Cancel</button>
          </div>
        </div>
      )}

      {rows.length === 0 && !adding && (
        <p style={{ color: S.text.muted, fontSize: 14.5, marginTop: 18 }}>
          Just the one resume above, which is all most people need.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 18 }}>
        {rows.map((p) => {
          const open = editing === p.id
          return (
            <div key={p.id} style={{ ...surfaceCard(S), borderRadius: 14, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 18px" }}>
                <span
                  aria-hidden
                  style={{
                    ...tileStructural(S), width: 40, height: 40, borderRadius: 11, flexShrink: 0,
                    display: "grid", placeItems: "center",
                  }}
                >
                  <ResumeIcon size={20} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15.5, fontWeight: 800, color: S.text.primary }}>
                    {p.name}
                  </span>
                  <span style={{ display: "block", fontSize: 13.5, color: S.text.muted, marginTop: 2 }}>
                    {p.resume_text?.trim() ? `${p.resume_text.trim().split(/\s+/).length} words` : "Nothing in it yet"}
                  </span>
                </span>
                {p.is_default ? (
                  <span style={{ color: S.meaning.replied.ink, fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                    Used by default
                  </span>
                ) : (
                  <button
                    onClick={() => void call(`/api/personas/${p.id}`, {
                      method: "PUT", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ is_default: true }),
                    }, "Couldn't switch the default.")}
                    style={quietBtn}
                  >
                    Use by default
                  </button>
                )}
                <button
                  onClick={() => {
                    setAdding(false)
                    setEditing(open ? null : p.id)
                    setDraft({ name: p.name, resume_text: p.resume_text ?? "" })
                  }}
                  style={quietBtn}
                >
                  {open ? "Close" : "Edit"}
                </button>
              </div>

              {open && (
                <div style={{ padding: "4px 18px 20px", borderTop: `1px solid ${S.borderSoft}` }}>
                  <div style={{ paddingTop: 18 }}>
                    <Field label="What to call it">
                      <input
                        style={control} value={draft.name} aria-label="What to call it"
                        onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      />
                    </Field>
                    <Field label="The resume for this version">
                      <textarea
                        style={{ ...areaControl, minHeight: 200, fontSize: 14 }}
                        value={draft.resume_text} aria-label="The resume for this version"
                        onChange={(e) => setDraft({ ...draft, resume_text: e.target.value })}
                      />
                    </Field>
                    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          const ok = await call(`/api/personas/${p.id}`, {
                            method: "PUT", headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ name: draft.name, resume_text: draft.resume_text }),
                          }, "That didn't save.")
                          if (ok) setEditing(null)
                        }}
                        style={{ ...actionStyle(S, "primary"), borderRadius: 10, padding: "10px 18px", fontSize: 14, fontFamily: "inherit" }}
                      >
                        Save
                      </button>
                      <button
                        onClick={async () => {
                          const e = await uploadResume((t) => setDraft((d) => ({ ...d, resume_text: t })))
                          if (e) setErr(e)
                        }}
                        style={quietBtn}
                      >
                        Upload a file
                      </button>
                      <RemoveVersion
                        onRemove={async () => {
                          const ok = await call(`/api/personas/${p.id}`, { method: "DELETE" }, "Couldn't remove it.")
                          if (ok) setEditing(null)
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Two taps, same as closing out a job. Removing a resume version is not undoable. */
function RemoveVersion({ onRemove }: { onRemove: () => Promise<void> }) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button onClick={() => setArmed(true)} style={{ ...quietBtn, color: S.meaning.error.ink, marginLeft: "auto" }}>
        Remove this version
      </button>
    )
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
      <span style={{ fontSize: 14, color: S.text.primary, fontWeight: 700 }}>Remove it?</span>
      <button
        onClick={onRemove}
        style={{
          background: S.meaning.error.ink, border: "none", color: "#FFFFFF", borderRadius: 10,
          padding: "8px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
        }}
      >
        Yes, remove
      </button>
      <button onClick={() => setArmed(false)} style={quietBtn}>Keep it</button>
    </span>
  )
}

const quietBtn: React.CSSProperties = {
  background: "none", border: "none", padding: 0, color: S.action.quietInk,
  fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
}
