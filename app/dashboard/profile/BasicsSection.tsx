"use client"

// Basics: who you are and what you're after. This is what drives job scoring,
// which is why it is the first section and why the section blurb says so.
//
// Resume text used to live in this same form as a sixth field, a 180px
// textarea sitting under four one-liners. It has moved to its own section,
// where it belongs beside the personas that are variants of it.

import { useState } from "react"
import { LIGHT as S, action as actionStyle } from "../../../lib/theme/surfaces"
import { JOB_TYPE_OPTIONS, normalizeJobType } from "../../../lib/jobType"
import { Field, control } from "./controls"

export type Profile = {
  id: string
  name: string | null
  email?: string | null
  job_type: string | null
  target_roles: string | null
  target_locations: string | null
  timeline: string | null
  resume_text: string | null
  profile_version: number
  purchase_date?: string | null
  refunded_at?: string | null
  active?: boolean | null
}

export function BasicsSection({
  profile, onSave,
}: {
  profile: Profile
  onSave: (patch: Partial<Profile>) => Promise<boolean>
}) {
  const [draft, setDraft] = useState({
    name: profile.name ?? "",
    job_type: profile.job_type ?? "",
    target_roles: profile.target_roles ?? "",
    target_locations: profile.target_locations ?? "",
    timeline: profile.timeline ?? "",
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const dirty =
    draft.name !== (profile.name ?? "") ||
    draft.job_type !== (profile.job_type ?? "") ||
    draft.target_roles !== (profile.target_roles ?? "") ||
    draft.target_locations !== (profile.target_locations ?? "") ||
    draft.timeline !== (profile.timeline ?? "")

  function toggleJobType(opt: string) {
    const cur = new Set((draft.job_type || "").split(",").map((s) => s.trim()).filter(Boolean))
    let next: string[]
    if (opt === "Any") next = cur.has("Any") ? [] : ["Any"]
    else if (cur.has(opt)) { cur.delete(opt); next = Array.from(cur) }
    else { cur.delete("Any"); cur.add(opt); next = Array.from(cur) }
    setDraft({ ...draft, job_type: normalizeJobType(next).value ?? "" })
    setSaved(false)
  }

  async function submit() {
    setSaving(true)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) { setSaved(true); setTimeout(() => setSaved(false), 2600) }
  }

  const set = (k: keyof typeof draft) => (v: string) => { setDraft({ ...draft, [k]: v }); setSaved(false) }

  return (
    <>
      <SectionHead
        title="Basics"
        blurb="Who you are and what you're looking for. This is what your job scoring runs on."
      />

      <Field label="Your name">
        <input
          style={control} value={draft.name} aria-label="Your name"
          onChange={(e) => set("name")(e.target.value)}
        />
      </Field>

      {/* Chips, not a dropdown: this is genuinely multi-select, and a
          multi-select <select> is one of the worst controls on the web. */}
      <Field label="What kind of work">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {JOB_TYPE_OPTIONS.map((opt) => {
            const active = (draft.job_type || "").split(",").map((s) => s.trim()).includes(opt)
            return (
              <button
                key={opt}
                type="button"
                onClick={() => toggleJobType(opt)}
                aria-pressed={active}
                style={{
                  padding: "9px 16px", borderRadius: 999, fontSize: 13.5, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                  border: `1px solid ${active ? S.text.primary : S.border}`,
                  background: active ? S.text.primary : S.card,
                  color: active ? "#FFFFFF" : S.text.muted,
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 }}>
        <Field label="Target role">
          <input
            style={control} value={draft.target_roles} aria-label="Target role"
            placeholder="e.g. Product Manager"
            onChange={(e) => set("target_roles")(e.target.value)}
          />
        </Field>
        <Field label="Timeline">
          <input
            style={control} value={draft.timeline} aria-label="Timeline"
            placeholder="e.g. Actively looking"
            onChange={(e) => set("timeline")(e.target.value)}
          />
        </Field>
      </div>

      <Field label="Where you want to work">
        <input
          style={control} value={draft.target_locations} aria-label="Where you want to work"
          placeholder="e.g. Chicago, New York, remote"
          onChange={(e) => set("target_locations")(e.target.value)}
        />
      </Field>

      {/* One Save for the whole section, unlike the networking form's
          save-on-blur. These five fields are short, they are read together by
          the scoring engine, and a partial save is a worse thing to have here
          than one more click. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
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
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && (
          <span style={{ color: S.meaning.replied.ink, fontSize: 14, fontWeight: 700 }}>Saved</span>
        )}
      </div>
    </>
  )
}

export function SectionHead({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h2 style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.3, color: S.text.primary, margin: 0 }}>
        {title}
      </h2>
      <p style={{ color: S.text.muted, fontSize: 14.5, lineHeight: "21px", margin: "6px 0 0" }}>
        {blurb}
      </p>
    </div>
  )
}
