"use client"

// Phase 7b — the networking client profile: the 16 merge variables plus the
// elevator pitch that Phase 8's templates will interpolate.
//
// Extracted from page.tsx so it can be rendered in isolation by a test (a Next
// page may only export route members).
//
// Grouped rather than presented as a flat wall of 17 inputs, because the groups
// are the argument for filling them in: "About you" and "Your target" are facts,
// "Your affinities" is the bit only the client knows, and the pitch is the one
// that actually costs effort.

import { useCallback, useEffect, useState } from "react"
import { T, card, input, textarea, btnPrimary, btnSecondary, fieldLabel } from "../../../../lib/dashboard-theme"
import { authFetch } from "../authFetch"

type Field = {
  key: string
  label: string
  placeholder: string
  multiline?: boolean
  /** Seeded fields say where the value came from, so a client knows why a box
   *  is already full and feels free to change it. */
  seededFrom?: string
}

const GROUPS: { title: string; blurb?: string; fields: Field[] }[] = [
  {
    title: "About you",
    fields: [
      { key: "client_first", label: "First name", placeholder: "How you sign off, e.g. Jordan", seededFrom: "your SIGNAL profile" },
      { key: "current_role_title", label: "Current role", placeholder: "e.g. Senior Marketing Analyst", seededFrom: "your résumé" },
      { key: "current_employer", label: "Current employer", placeholder: "e.g. Northbrook Consumer Group", seededFrom: "your résumé" },
      { key: "school", label: "School", placeholder: "e.g. University of Illinois", seededFrom: "your SIGNAL profile" },
      { key: "grad_year", label: "Grad year", placeholder: "e.g. 2020", seededFrom: "your SIGNAL profile" },
      { key: "degree", label: "Degree", placeholder: "e.g. BS, Business Analytics" },
      // The only must-have field with no honest source — see 7a. Seeding it from
      // target_locations would put where they want to WORK in a box that means
      // where they ARE: wrong in a way that looks right, so nobody would correct it.
      { key: "city", label: "City", placeholder: "Where you're based, e.g. Chicago" },
    ],
  },
  {
    title: "Your target",
    fields: [
      { key: "target_field", label: "Target field", placeholder: "e.g. Marketing", seededFrom: "your SIGNAL profile" },
      { key: "target_role", label: "Target role", placeholder: "e.g. Marketing Analytics", seededFrom: "your SIGNAL profile" },
      { key: "timeframe", label: "Timeframe", placeholder: "e.g. Immediate, or Summer 2026", seededFrom: "your SIGNAL profile" },
      { key: "key_strength", label: "Key strength", placeholder: "The one thing you want remembered", seededFrom: "your coach's notes", multiline: true },
    ],
  },
  {
    title: "Your affinities",
    blurb: "Shared ground that opens a door — alumni network, a past employer, a community, anything you have in common with someone you're reaching out to. Only you know these.",
    fields: [
      { key: "affinity_1", label: "Affinity 1", placeholder: "e.g. Illinois alumni" },
      { key: "affinity_2", label: "Affinity 2", placeholder: "e.g. ex-Deloitte" },
      { key: "affinity_3", label: "Affinity 3", placeholder: "e.g. Chicago Women in Analytics" },
    ],
  },
  {
    title: "Links",
    fields: [
      { key: "resume_link", label: "Résumé link", placeholder: "A shareable link — Drive, Dropbox, personal site" },
      { key: "calendar_link", label: "Calendar link", placeholder: "e.g. your Calendly, so a chat takes one click to book" },
    ],
  },
  {
    title: "Elevator pitch",
    blurb: "Two or three sentences in your own voice. Templates drop this in whole, so write it the way you'd say it out loud — not the way a CV reads.",
    fields: [
      { key: "elevator_pitch", label: "Elevator pitch", placeholder: "I'm a marketing analyst moving into…", multiline: true },
    ],
  },
]

const RESUME_FIELDS = new Set(["current_role_title", "current_employer"])

type Profile = Record<string, string | string[] | null>
type Completeness = { filled: number; total: number; missing: string[] }

export function ProfileForm() {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [meter, setMeter] = useState<Completeness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [banner, setBanner] = useState<string | null>(null)
  // Phase 2 of the seed: the two résumé-derived fields arrive on a second round
  // trip so the form is usable immediately instead of sitting behind an LLM call.
  const [resumePending, setResumePending] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/network/profile")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load profile (${res.status})`)
      setProfile(j.profile ?? {})
      setMeter(j.completeness ?? null)
      setResumePending(Boolean(j.resume_pending))
      // Announce anything auto-filled since the last visit, so new text never
      // appears unexplained. Only fires for later fills — the first seed is
      // already explained by the page copy.
      const filled: string[] = j.auto_filled ?? []
      if (filled.length) {
        setBanner(`${filled.length} field${filled.length === 1 ? "" : "s"} filled in from your profile. Change anything that doesn't sound like you.`)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // Fires after the form is already on screen. Failure is silent — these two
  // fields simply stay blank and editable, which is the same outcome as a client
  // with no résumé on file.
  useEffect(() => {
    if (!resumePending) return
    let alive = true
    void (async () => {
      try {
        const res = await authFetch("/api/network/profile", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "seed_resume" }),
        })
        const j = await res.json().catch(() => ({}))
        if (alive && res.ok && j?.ok) {
          setProfile(j.profile ?? {})
          setMeter(j.completeness ?? null)
        }
      } catch {
        /* leave the fields blank */
      } finally {
        if (alive) setResumePending(false)
      }
    })()
    return () => { alive = false }
  }, [resumePending])

  // Saved on blur rather than behind one Save button: 17 fields is too many to
  // ask someone to fill before anything is kept.
  async function saveField(key: string, value: string) {
    const current = (profile?.[key] ?? "") as string
    if (value.trim() === (current ?? "").trim()) return
    setSavingKey(key)
    setError(null)
    try {
      const res = await authFetch("/api/network/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Save failed (${res.status})`)
      setProfile(j.profile ?? {})
      setMeter(j.completeness ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingKey(null)
    }
  }

  async function refreshFromProfile() {
    setRefreshing(true)
    setError(null)
    try {
      const res = await authFetch("/api/network/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Refresh failed (${res.status})`)
      setProfile(j.profile ?? {})
      setMeter(j.completeness ?? null)
      const n = (j.refreshed ?? []).length
      setBanner(n === 0
        ? "Nothing to refresh — everything here is yours now."
        : `Refreshed ${n} field${n === 1 ? "" : "s"} you hadn't edited. Anything you'd changed was left alone.`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRefreshing(false)
    }
  }

  if (loading) return <div style={{ color: T.DIM, fontSize: 13 }}>Loading…</div>

  return (
    <div>
      {meter && (
        <div style={{ ...card, padding: "14px 16px", marginBottom: 16 }} data-testid="completeness">
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: T.TEXT, fontSize: 18, fontWeight: 900 }} data-testid="completeness-count">
              {meter.filled} of {meter.total}
            </span>
            <span style={{ color: T.MUTED, fontSize: 12.5 }}>
              {meter.filled === meter.total
                ? "Complete — every template will have what it needs."
                : "filled. Templates leave a blank wherever one of these is empty."}
            </span>
            <button onClick={() => void refreshFromProfile()} disabled={refreshing}
              style={{ ...btnSecondary, marginLeft: "auto", padding: "7px 12px", fontSize: 12 }}>
              {refreshing ? "Refreshing…" : "Refresh from profile"}
            </button>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: T.BORDER_SOFT, marginTop: 10, overflow: "hidden" }}>
            <div style={{
              width: `${Math.round((meter.filled / meter.total) * 100)}%`, height: "100%",
              background: meter.filled === meter.total ? T.SUCCESS : T.WRN_BLUE,
            }} />
          </div>
        </div>
      )}

      {banner && (
        <div style={{ padding: "9px 12px", borderRadius: 10, background: T.SUCCESS_BG, color: T.TEXT, fontSize: 12, marginBottom: 14 }}>
          {banner}
        </div>
      )}
      {error && <div style={{ color: T.ERROR, fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {GROUPS.map((g) => (
        <section key={g.title} style={{ ...card, padding: "16px 18px", marginBottom: 14 }}>
          <h2 style={{ ...fieldLabel, textTransform: "uppercase", margin: "0 0 4px" }}>{g.title}</h2>
          {g.blurb && <p style={{ color: T.MUTED, fontSize: 11.5, lineHeight: "17px", margin: "0 0 12px" }}>{g.blurb}</p>}
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {g.fields.map((f) => {
              const value = (profile?.[f.key] ?? "") as string
              const pending = resumePending && RESUME_FIELDS.has(f.key)
              return (
                <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={fieldLabel}>
                    {f.label}
                    {f.seededFrom && !value && <span style={{ color: T.DIM, fontWeight: 600 }}> · from {f.seededFrom}</span>}
                  </span>
                  {f.multiline ? (
                    <textarea
                      key={`${f.key}:${value}`}
                      defaultValue={value}
                      aria-label={f.label}
                      placeholder={f.placeholder}
                      rows={3}
                      onBlur={(e) => void saveField(f.key, e.target.value)}
                      style={{ ...textarea, fontSize: 13 }}
                    />
                  ) : (
                    <input
                      // Remount when the value changes so a phase-2 arrival is
                      // actually shown — defaultValue alone would ignore it.
                      key={`${f.key}:${value}`}
                      defaultValue={value}
                      aria-label={f.label}
                      placeholder={pending ? "Reading your résumé…" : f.placeholder}
                      // Disabled while pending: the field cannot be typed into,
                      // so the late arrival has nothing of the user's to clobber.
                      disabled={pending}
                      onBlur={(e) => void saveField(f.key, e.target.value)}
                      style={{ ...input, height: 38, fontSize: 13, opacity: pending ? 0.6 : 1 }}
                    />
                  )}
                  {savingKey === f.key && <span style={{ color: T.DIM, fontSize: 10 }}>Saving…</span>}
                </label>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
