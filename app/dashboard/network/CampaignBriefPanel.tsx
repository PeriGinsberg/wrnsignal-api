"use client"

// The Networking Campaign brief, on the client's networking board.
//
// WHY IT LIVES HERE rather than on the coach's client page. The brief is what
// the plan is built from, and the plan, the list and the contacts are all on
// this board. A coach filling one in wants the board in front of them, and
// putting it on the dark client page would mean a second copy of this form in
// the other theme within a release. The client page links here already.
//
// COACH ONLY. The board is shared with the client; the brief is the coach's
// working document and the chain it starts assigns work to coaches. The host
// renders this only when a coach is looking at a client's board.

import { useCallback, useEffect, useState } from "react"
import { LIGHT as S, action as actionStyle, surfaceCard } from "../../../lib/theme/surfaces"

const ACCENT = "#009BFF"
const RULE = "#FF6B00"
const TINT = "#FFEEDC"

export type Brief = {
  id: string
  name: string
  status: "draft" | "submitted"
  education_status: string | null
  immediate_goals: string | null
  primary_roles: string[]
  secondary_roles: string[]
  primary_industries: string[]
  secondary_industries: string[]
  locations: string[]
  notes_for_builder: string | null
  prefilled_fields: string[]
  ai_suggestions: { suggestions?: Suggestion[]; error?: string | null } | null
  submitted_at: string | null
  created_at: string
  plan?: { id: string; status: string; shared_at: string | null; drive_file_url: string | null } | null
  open_tasks?: { id: string; title: string; due_at: string | null }[]
}

type Suggestion = { field: string; value: string[] | string; evidence: string }

const LIST_FIELDS = [
  ["primary_roles", "Primary roles"],
  ["secondary_roles", "Secondary roles"],
  ["primary_industries", "Primary industries"],
  ["secondary_industries", "Secondary industries"],
  ["locations", "Locations"],
] as const

const TEXT_FIELDS = [
  ["education_status", "Education status", "Senior at Indiana University, graduating May 2026"],
  ["immediate_goals", "Immediate goals", "What they are trying to do next, in their words"],
  ["notes_for_builder", "Notes for the builder", "Anything else Erin needs before building the list"],
] as const

const FIELD_LABELS: Record<string, string> = {
  ...Object.fromEntries(LIST_FIELDS.map(([k, l]) => [k, l])),
  ...Object.fromEntries(TEXT_FIELDS.map(([k, l]) => [k, l])),
}

function day(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

type FormState = Record<string, string>

/** Lists are edited as plain comma-separated text. */
function toForm(b: Partial<Brief>): FormState {
  const out: FormState = { name: b.name ?? "" }
  for (const [k] of LIST_FIELDS) out[k] = ((b as any)[k] ?? []).join(", ")
  for (const [k] of TEXT_FIELDS) out[k] = ((b as any)[k] ?? "") || ""
  return out
}

function fromForm(f: FormState): Record<string, any> {
  const out: Record<string, any> = { name: f.name }
  // Sent as the raw string: the server splits and de-duplicates, so the form
  // and the API cannot disagree about what "Analyst, analyst" means.
  for (const [k] of LIST_FIELDS) out[k] = f[k] ?? ""
  for (const [k] of TEXT_FIELDS) out[k] = (f[k] ?? "").trim() || null
  return out
}

export function CampaignBriefModal({
  brief,
  suggestions,
  suggestionsError,
  authFetch,
  onClose,
  onSaved,
}: {
  brief: Brief
  suggestions: Suggestion[]
  suggestionsError: string | null
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(() => toForm(brief))
  const [busy, setBusy] = useState<null | "save" | "submit">(null)
  const [error, setError] = useState<string | null>(null)
  // A suggestion the coach has taken or waved away stops being offered.
  const [handled, setHandled] = useState<Set<string>>(new Set())

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // A SUBMITTED BRIEF IS READ-ONLY, and the form says so rather than letting
  // the coach type into it and meet a 409 on save. Erin may already be
  // building from these values; changing them would review her against a
  // brief she never read.
  const readOnly = brief.status === "submitted"

  function accept(s: Suggestion) {
    const text = Array.isArray(s.value) ? s.value.join(", ") : s.value
    setForm((f) => {
      const existing = (f[s.field] ?? "").trim()
      // Appended, not replaced. By the time a coach clicks Accept they may have
      // typed something in the field themselves, and overwriting it would throw
      // away the one value in there that is certainly right.
      return { ...f, [s.field]: existing ? `${existing}, ${text}` : text }
    })
    setHandled((h) => new Set(h).add(s.field))
  }

  async function save(submit: boolean) {
    setBusy(submit ? "submit" : "save")
    setError(null)
    try {
      const body = fromForm(form)
      if (submit) body.status = "submitted"
      const res = await authFetch(`/api/coach/briefs/${brief.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `That did not save (${res.status})`)
      onSaved()
      onClose()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(null)
    }
  }

  const label: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 800, letterSpacing: "0.07em",
    textTransform: "uppercase", color: S.text.muted, marginBottom: 5,
  }
  const input: React.CSSProperties = {
    width: "100%", padding: "9px 11px", borderRadius: 8, fontSize: 14,
    border: `1px solid ${S.border}`, background: "#FFFFFF", color: S.text.primary,
    fontFamily: "inherit", boxSizing: "border-box",
  }

  const open = suggestions.filter((s) => !handled.has(s.field))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Campaign brief"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
      style={{
        position: "fixed", inset: 0, background: "rgba(19,41,74,0.45)", zIndex: 100,
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "40px 16px", overflowY: "auto",
      }}
    >
      <div style={{ ...surfaceCard(S, true), width: "100%", maxWidth: 680, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", color: ACCENT, fontWeight: 800 }}>
              Campaign brief
            </div>
            <h2 style={{ margin: "4px 0 0 0", fontSize: 20, color: S.text.primary }}>
              {brief.status === "draft" ? "New campaign" : brief.name}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close" disabled={busy !== null} style={{
            border: "none", background: "transparent", fontSize: 24, lineHeight: 1,
            color: S.text.dim, cursor: "pointer", padding: 0,
          }}>×</button>
        </div>

        {/* SUGGESTIONS ARE OFFERED, NOT APPLIED. They came out of an AI read of
            the client's profile, and a guess that arrives already in the field
            is indistinguishable from a fact the coach entered. */}
        {open.length > 0 && (
          <div style={{ marginTop: 18, background: TINT, borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.09em", textTransform: "uppercase", color: ACCENT, fontWeight: 800, marginBottom: 8 }}>
              From the profile — check before accepting
            </div>
            {open.map((s) => (
              <div key={s.field} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "7px 0" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: S.text.primary }}>
                    <strong>{FIELD_LABELS[s.field] ?? s.field}:</strong>{" "}
                    {Array.isArray(s.value) ? s.value.join(", ") : s.value}
                  </div>
                  {s.evidence && (
                    <div style={{ fontSize: 12, color: S.text.muted, marginTop: 2, fontStyle: "italic" }}>
                      “{s.evidence}”
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                  <button onClick={() => accept(s)} style={{
                    border: `1px solid ${S.border}`, background: "#FFFFFF", borderRadius: 7,
                    padding: "5px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", color: S.text.primary,
                  }}>Accept</button>
                  <button onClick={() => setHandled((h) => new Set(h).add(s.field))} style={{
                    border: "none", background: "transparent", fontSize: 12, fontWeight: 700,
                    cursor: "pointer", color: S.text.muted,
                  }}>Ignore</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Said out loud. An empty suggestion list otherwise reads as "the
            profile says nothing", which is a different fact. */}
        {suggestionsError && (
          <div style={{ marginTop: 14, fontSize: 12.5, color: S.meaning.error.ink }}>
            {suggestionsError}
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <label style={label} htmlFor="brief-name">Campaign name</label>
          <input id="brief-name" style={input} value={form.name} readOnly={readOnly} onChange={(e) => set("name", e.target.value)} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, marginTop: 16 }}>
          {LIST_FIELDS.map(([k, l]) => (
            <div key={k}>
              <label style={label} htmlFor={`brief-${k}`}>
                {l}
                {brief.prefilled_fields?.includes(k) && (
                  <span style={{ marginLeft: 6, color: ACCENT, fontWeight: 700, textTransform: "none", letterSpacing: 0 }}>
                    from the profile
                  </span>
                )}
              </label>
              <input
                id={`brief-${k}`} style={input} value={form[k]} readOnly={readOnly}
                placeholder={readOnly ? "" : "Separate with commas"}
                onChange={(e) => set(k, e.target.value)}
              />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          {TEXT_FIELDS.map(([k, l, ph]) => (
            <div key={k}>
              <label style={label} htmlFor={`brief-${k}`}>{l}</label>
              <textarea
                id={`brief-${k}`} style={{ ...input, minHeight: k === "notes_for_builder" ? 80 : 56, resize: "vertical" }}
                value={form[k]} placeholder={readOnly ? "" : ph} readOnly={readOnly}
                onChange={(e) => set(k, e.target.value)}
              />
            </div>
          ))}
        </div>

        {error && (
          <div style={{ marginTop: 14, fontSize: 13, color: S.meaning.error.ink }}>{error}</div>
        )}

        {readOnly ? (
          <div style={{ display: "flex", gap: 10, marginTop: 22, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={onClose} style={{ ...actionStyle(S, "primary"), padding: "9px 18px", fontSize: 14 }}>Close</button>
            <span style={{ fontSize: 12, color: S.text.muted }}>
              Submitted {day(brief.submitted_at)}. To change the targets, start a new campaign.
            </span>
          </div>
        ) : (
        <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => void save(true)}
            disabled={busy !== null}
            style={{ ...actionStyle(S, "primary"), padding: "9px 18px", fontSize: 14, opacity: busy ? 0.6 : 1 }}
          >
            {busy === "submit" ? "Submitting…" : "Submit campaign"}
          </button>
          <button
            onClick={() => void save(false)}
            disabled={busy !== null}
            style={{
              padding: "9px 18px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${S.border}`, background: "transparent", color: S.text.secondary,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          {/* Said before it happens, not after. Submitting hands the campaign to
              somebody else and closes it to editing. */}
          <span style={{ fontSize: 12, color: S.text.muted }}>
            Submitting assigns the build and locks the brief.
          </span>
        </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

export function CampaignBriefPanel({
  clientProfileId,
  authFetch,
  onChanged,
}: {
  clientProfileId: string
  authFetch: (url: string, opts?: RequestInit) => Promise<Response>
  /** The host re-reads the plan bar: a submitted campaign changes what is next. */
  onChanged?: () => void
}) {
  const [briefs, setBriefs] = useState<Brief[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Brief | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/coach/briefs?client_profile_id=${encodeURIComponent(clientProfileId)}`)
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not load campaigns (${res.status})`)
      setBriefs(j.briefs ?? [])
    } catch (e: any) {
      setError(e?.message ?? String(e))
    }
  }, [authFetch, clientProfileId])

  useEffect(() => { void load() }, [load])

  async function startNew() {
    setCreating(true)
    setError(null)
    try {
      const res = await authFetch("/api/coach/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_profile_id: clientProfileId }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || `Could not start a campaign (${res.status})`)
      setSuggestions(j.suggestions ?? [])
      setSuggestionsError(j.suggestions_error ?? null)
      setEditing(j.brief)
      await load()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setCreating(false)
    }
  }

  function openExisting(b: Brief) {
    setSuggestions((b.ai_suggestions?.suggestions ?? []) as Suggestion[])
    setSuggestionsError(b.ai_suggestions?.error ?? null)
    setEditing(b)
  }

  if (!briefs) return null

  const draft = briefs.find((b) => b.status === "draft") ?? null
  const current = briefs.find((b) => b.status === "submitted") ?? null
  const rest = briefs.filter((b) => b !== draft && b !== current)

  const line = (b: Brief) => {
    const bits = [b.primary_roles?.join(", "), b.primary_industries?.join(", "), b.locations?.join(", ")]
      .filter(Boolean)
    return bits.join(" · ")
  }

  return (
    <>
      <div style={{
        background: S.card,
        border: `1px solid ${S.borderSoft}`,
        borderLeft: `3px solid ${current ? ACCENT : RULE}`,
        borderRadius: 10, padding: "14px 16px", marginBottom: 16,
        display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{
            fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase",
            color: current ? ACCENT : RULE, fontWeight: 700, marginBottom: 3,
          }}>
            Networking campaign
          </div>

          {!briefs.length && (
            <div style={{ fontSize: 14, color: S.text.primary }}>
              No campaign has been briefed for this client yet.
            </div>
          )}

          {draft && (
            <div style={{ fontSize: 14, color: S.text.primary }}>
              <strong>{draft.name}</strong> is a draft. It has not been submitted, so nobody has been assigned it.
            </div>
          )}

          {current && (
            <div style={{ fontSize: 14, color: S.text.primary }}>
              <strong>{current.name}</strong>, submitted {day(current.submitted_at)}.
            </div>
          )}

          {current && line(current) && (
            <div style={{ fontSize: 12.5, color: S.text.muted, marginTop: 3 }}>{line(current)}</div>
          )}

          {/* WHERE IT IS UP TO, said as the task that is open rather than as a
              stage name. The coach can act on a task; a stage is trivia. */}
          {current?.open_tasks?.length ? (
            <div style={{ fontSize: 12.5, color: S.text.muted, marginTop: 3 }}>
              Waiting on: {current.open_tasks.map((t) => t.title).join(", ")}
            </div>
          ) : current ? (
            <div style={{ fontSize: 12.5, color: S.text.muted, marginTop: 3 }}>
              No tasks are open on this campaign.
            </div>
          ) : null}

          {error && <div style={{ fontSize: 12.5, color: S.meaning.error.ink, marginTop: 4 }}>{error}</div>}

          {rest.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                border: "none", background: "transparent", padding: "6px 0 0 0", cursor: "pointer",
                fontSize: 12.5, fontWeight: 700, color: S.text.secondary,
              }}
            >
              {expanded ? "Hide" : `Earlier campaigns (${rest.length})`}
            </button>
          )}

          {expanded && rest.map((b) => (
            <div key={b.id} style={{
              display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0",
              borderTop: `1px solid ${S.borderSoft}`, marginTop: 6,
            }}>
              <button onClick={() => openExisting(b)} style={{
                border: "none", background: "transparent", padding: 0, cursor: "pointer",
                fontSize: 13, fontWeight: 700, color: S.text.primary, textAlign: "left",
              }}>{b.name}</button>
              <span style={{ fontSize: 12, color: S.text.dim }}>{day(b.submitted_at ?? b.created_at)}</span>
              {b.plan?.drive_file_url && (
                <a href={b.plan.drive_file_url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: ACCENT, textDecoration: "none" }}>
                  Plan {b.plan.shared_at ? "(shared)" : "(built)"}
                </a>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: "0 0 auto" }}>
          {draft && (
            <button onClick={() => openExisting(draft)} style={{ ...actionStyle(S, "primary"), padding: "8px 16px", fontSize: 13 }}>
              Finish the draft
            </button>
          )}
          {current && (
            <button onClick={() => openExisting(current)} style={{
              padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${S.border}`, background: "transparent", color: S.text.secondary,
            }}>View brief</button>
          )}
          {!draft && (
            <button onClick={() => void startNew()} disabled={creating} style={{
              ...(current
                ? { padding: "8px 16px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                    border: `1px solid ${S.border}`, background: "transparent", color: S.text.secondary }
                : { ...actionStyle(S, "primary"), padding: "8px 16px", fontSize: 13 }),
              opacity: creating ? 0.6 : 1,
            }}>
              {creating ? "Reading the profile…" : "New campaign"}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <CampaignBriefModal
          brief={editing}
          suggestions={editing.status === "submitted" ? [] : suggestions}
          suggestionsError={editing.status === "submitted" ? null : suggestionsError}
          authFetch={authFetch}
          onClose={() => setEditing(null)}
          onSaved={() => { void load(); onChanged?.() }}
        />
      )}
    </>
  )
}
