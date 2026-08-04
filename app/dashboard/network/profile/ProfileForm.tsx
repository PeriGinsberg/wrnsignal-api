"use client"

// Phase 7b — the networking client profile: the 16 merge variables plus the
// elevator pitch that Phase 8's templates will interpolate.
//
// Extracted from page.tsx so it can be rendered in isolation by a test (a Next
// page may only export route members).
//
// Redesign step 8 (2026-08-04): light theme, and this form is now a SECTION of
// My Profile rather than its own route. Structure, testids, field defs and copy
// are all unchanged; only the palette moved.
//
// Grouped rather than presented as a flat wall of 17 inputs, because the groups
// are the argument for filling them in: "About you" and "Your target" are facts,
// "Things in Common" is the bit only the client knows, and the pitch is the one
// that actually costs effort.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, surfaceCard } from "../../../../lib/theme/surfaces"
import { authFetch } from "../authFetch"
import { Field, type FieldDef } from "./Field"
import { ProgressHeader } from "./ProgressHeader"
import { groupProgress } from "./fieldState"

// Field shape and the 17 entries are UNCHANGED — the restructure is
// presentation only. `seededFrom` still says where a value came from, so a
// client knows why a box is already full and feels free to change it.
const GROUPS: { title: string; blurb?: string; fields: FieldDef[] }[] = [
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
    // LABEL ONLY (2026-08-04). "Affinity" is our word; the contact record has
    // said "Something in Common" for the same idea since the vocab pass, and
    // two screens naming one concept differently is how a vocabulary drifts.
    // The keys stay affinity_1..3 and the merge tokens stay [AFFINITY_1..3];
    // nothing about the data or the templates moves.
    title: "Things in Common",
    blurb: "Shared ground that opens a door — alumni network, a past employer, a community, anything you have in common with someone you're reaching out to. Only you know these.",
    fields: [
      { key: "affinity_1", label: "Thing in common 1", placeholder: "e.g. Illinois alumni" },
      { key: "affinity_2", label: "Thing in common 2", placeholder: "e.g. ex-Deloitte" },
      { key: "affinity_3", label: "Thing in common 3", placeholder: "e.g. Chicago Women in Analytics" },
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

  if (loading) return <div style={{ color: S.text.muted, fontSize: 14.5 }}>Loading…</div>

  return (
    <div>
      {meter && (
        <ProgressHeader meter={meter} profile={profile} refreshing={refreshing}
          onRefresh={() => void refreshFromProfile()} />
      )}

      {banner && (
        <div style={{ padding: "11px 16px", borderRadius: 10, background: S.meaning.sequence.fill, color: S.meaning.sequence.ink, fontSize: 14, lineHeight: "20px", marginBottom: 16 }}>
          {banner}
        </div>
      )}
      {error && <div style={{ color: S.meaning.error.ink, fontSize: 14, marginBottom: 14 }}>{error}</div>}

      {GROUPS.map((g) => {
        const prog = groupProgress(g.fields.map((f) => f.key), profile)
        const done = prog.filled === prog.total
        return (
          <section key={g.title} style={{ ...surfaceCard(S), borderRadius: 14, padding: "18px 22px", marginBottom: 12 }}
            data-testid={`section-${g.title.toLowerCase().replace(/\s+/g, "-")}`}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "0 0 6px" }}>
              <h2 style={{ color: S.text.primary, fontSize: 15.5, fontWeight: 800, margin: 0 }}>{g.title}</h2>
              {/* Per-section counts so the user feels movement inside a section
                  rather than only against the distant 17. */}
              <span data-testid="section-count" style={{ color: done ? S.meaning.replied.ink : S.text.dim, fontSize: 13, fontWeight: 700 }}>
                · {prog.filled} of {prog.total}
              </span>
            </div>
            {g.blurb && <p style={{ color: S.text.muted, fontSize: 14, lineHeight: "21px", margin: "0 0 16px" }}>{g.blurb}</p>}
            <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
              {g.fields.map((f) => (
                <Field
                  key={f.key}
                  def={f}
                  value={(profile?.[f.key] ?? "") as string}
                  pending={resumePending && RESUME_FIELDS.has(f.key)}
                  saving={savingKey === f.key}
                  featured={f.key === "elevator_pitch"}
                  onSave={(k, v) => void saveField(k, v)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
