"use client"

// The consult screen (prospect workflow, Phase 1).
//
// Top: everything known about the prospect, editable. Below: what the coach
// fills in during the call. Saving makes it the record; the values it replaced
// go to History. Bottom: the outcome, one of Consult complete, No-show or Not
// a fit, each confirmed against the chain of events it runs.
//
// Opens from the prospect page's "Open consult", and from the "Prep for
// consult with [name]" task's Go button.

import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { useParams } from "next/navigation"
import { T, btnPrimary, btnSecondary, card, eyebrow, input, label, selectDarkInk, selectDarkOption, textarea } from "../../../../../../lib/dashboard-theme"
import { SavingSpinner } from "../../../SavingSpinner"
import { LoadingShell } from "../../../LoadingShell"
import { apiJson } from "../../../_tasks/taskClient"
import { LeadSourceFields, ParentFields } from "../../../_prospects/leadSourceUi"
import { ChainConfirmDialog } from "../../../_prospects/dialogs"
import {
  MATERIALS,
  MATERIAL_LABEL,
  MATERIAL_STATES,
  MATERIAL_STATE_LABEL,
  SEARCH_GOALS,
  SEARCH_GOAL_LABEL,
  SERVICES,
  SERVICE_LABEL,
  type ConsultOutcome,
  type Service,
} from "../../../../../../lib/prospects/model"
import {
  fillName,
  formFrom,
  isDirty,
  saveBody,
  type ConsultForm,
  type ConsultProspect,
  type ConsultRecord,
  type KnownField,
  type LiveField,
} from "./consultForm"

type Loaded = {
  prospect: ConsultProspect
  consult: ConsultRecord
  packages: { id: string; name: string }[]
  outcome_chain: Record<ConsultOutcome, string[]>
}

const OUTCOME_LABEL: Record<ConsultOutcome, string> = {
  completed: "Consult complete",
  no_show: "No-show",
  not_a_fit: "Not a fit",
}

const sectionStyle: CSSProperties = { ...card, padding: 22, marginBottom: 18 }
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }
const fieldLabel = { ...label, color: T.INK_LINK, display: "block", marginBottom: 6 } as const

function fmtDay(d: string | null): string | null {
  if (!d) return null
  return new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

export default function ConsultPage() {
  const params = useParams()
  const id = params.id as string
  const [data, setData] = useState<Loaded | null>(null)
  const [loaded, setLoaded] = useState<ConsultForm | null>(null)
  const [form, setForm] = useState<ConsultForm | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [outcome, setOutcome] = useState<ConsultOutcome | null>(null)
  const [minutes, setMinutes] = useState("")
  const [packageId, setPackageId] = useState("")
  const [notFitNotes, setNotFitNotes] = useState("")

  const load = useCallback(async () => {
    try {
      const j = await apiJson<Loaded>(`/api/coach/prospects/${id}/consult`)
      setData(j)
      const f = formFrom(j.prospect, j.consult)
      setLoaded(f)
      setForm(f)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load the consult")
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  if (loadError) return <div style={{ padding: 24, color: T.ERROR }}>{loadError}</div>
  if (!data || !form || !loaded) return <LoadingShell label="Loading consult..." />

  const p = data.prospect
  const c = data.consult
  const dirty = isDirty(form, loaded)
  const closed = p.lifecycle_status !== "Prospect" || p.prospect_status === "won" || p.prospect_status === "lost"

  const setKnown = (k: KnownField, v: string) => setForm((f) => (f ? { ...f, known: { ...f.known, [k]: v } } : f))
  const setLive = (k: LiveField, v: string) => setForm((f) => (f ? { ...f, live: { ...f.live, [k]: v } } : f))
  const toggleService = (s: Service) => setForm((f) => {
    if (!f) return f
    const has = f.services.includes(s)
    return { ...f, services: has ? f.services.filter((x) => x !== s) : SERVICES.filter((x) => x === s || f.services.includes(x)) }
  })

  async function save(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!form) return { ok: false, error: "Nothing to save" }
    setSaving(true)
    setSaveMsg(null)
    try {
      const j = await apiJson<{ changed: string[] }>(`/api/coach/prospects/${id}/consult`, {
        method: "PUT",
        body: JSON.stringify(saveBody(form)),
      })
      const n = j.changed.length
      setSaveMsg({ ok: true, text: n ? `Saved. ${n} field${n === 1 ? "" : "s"} updated; the earlier values are in History.` : "No changes to save." })
      await load()
      return { ok: true }
    } catch (e) {
      const error = e instanceof Error ? e.message : "Couldn't save"
      setSaveMsg({ ok: false, text: error })
      return { ok: false, error }
    } finally {
      setSaving(false)
    }
  }

  async function recordOutcome(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!outcome) return { ok: false, error: "Pick an outcome" }
    // Unsaved notes go in first, so the record the outcome closes is complete.
    if (dirty) {
      const s = await save()
      if (!s.ok) return s
    }
    const body =
      outcome === "completed" ? { outcome, package_id: packageId, minutes: minutes.trim() || null }
        : outcome === "not_a_fit" ? { outcome, notes: notFitNotes.trim() || null }
          : { outcome }
    try {
      await apiJson(`/api/coach/prospects/${id}/consult/outcome`, { method: "POST", body: JSON.stringify(body) })
      await load()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "Couldn't record the outcome" }
    }
  }

  const text = (k: KnownField, labelText: string, type = "text") => (
    <label htmlFor={`consult-${k}`} style={{ display: "block" }}>
      <span style={fieldLabel}>{labelText}</span>
      <input id={`consult-${k}`} type={type} style={{ ...input, ...(type === "date" ? { colorScheme: "dark" } : {}) }}
        value={form.known[k]} onChange={(e) => setKnown(k, e.target.value)} />
    </label>
  )
  const area = (k: LiveField, labelText: string, rows = 3) => (
    <label htmlFor={`consult-${k}`} style={{ display: "block" }}>
      <span style={fieldLabel}>{labelText}</span>
      <textarea id={`consult-${k}`} style={{ ...textarea, minHeight: rows * 22 }} value={form.live[k]} onChange={(e) => setLive(k, e.target.value)} />
    </label>
  )
  const short = (k: LiveField, labelText: string) => (
    <label htmlFor={`consult-${k}`} style={{ display: "block" }}>
      <span style={fieldLabel}>{labelText}</span>
      <input id={`consult-${k}`} type="text" style={input} value={form.live[k]} onChange={(e) => setLive(k, e.target.value)} />
    </label>
  )

  return (
    <div style={{ paddingBottom: 40 }}>
      <a href={`/dashboard/coach/prospects/${id}`} style={{ fontSize: 13, fontWeight: 600, color: T.INK_EMPHASIS, textDecoration: "none", display: "inline-block", marginBottom: 14 }}>
        ← Back to {p.name || "prospect"}
      </a>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: T.TEXT, margin: 0 }}>Consult: {p.name || "Unnamed prospect"}</h1>
        <span style={{ fontSize: 13, color: T.MUTED }}>{c.scheduled_for ? `Booked for ${fmtDay(c.scheduled_for)}` : "Not booked yet"}</span>
        {c.outcome && (
          <span style={{ fontSize: 12, fontWeight: 800, color: T.INK_EMPHASIS }}>
            Outcome: {OUTCOME_LABEL[c.outcome]}{c.outcome === "completed" && c.minutes_logged != null ? ` (${c.minutes_logged} min)` : ""}
          </span>
        )}
      </div>

      {/* What we know */}
      <section aria-label="What we know" style={sectionStyle}>
        <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 14 }}>WHAT WE KNOW</div>
        <div style={grid}>
          {text("name", "NAME")}
          {text("invited_email", "EMAIL", "email")}
          {text("phone", "PHONE", "tel")}
        </div>
        <div style={{ marginTop: 14 }}>
          <ParentFields idPrefix="consult" value={{ parent_name: form.known.parent_name, parent_email: form.known.parent_email, parent_phone: form.known.parent_phone }}
            onChange={(v) => setForm((f) => (f ? { ...f, known: { ...f.known, ...v } } : f))} />
        </div>
        <div style={{ marginTop: 14 }}>
          <LeadSourceFields idPrefix="consult"
            value={{ source_category: form.known.source_category, source_detail: form.known.source_detail, referred_by_name: form.known.referred_by_name, referred_by_email: form.known.referred_by_email }}
            onChange={(v) => setForm((f) => (f ? { ...f, known: { ...f.known, ...v } } : f))} />
        </div>
        <div style={{ ...grid, marginTop: 14 }}>
          {text("university", "SCHOOL")}
          {text("field_of_study", "MAJOR")}
          {text("grad_date", "GRADUATION DATE", "date")}
          {text("current_title", "CURRENT TITLE")}
          {text("current_company", "CURRENT COMPANY")}
        </div>
      </section>

      {/* During the call */}
      <section aria-label="During the call" style={sectionStyle}>
        <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 14 }}>DURING THE CALL <span style={{ color: T.DIM, fontWeight: 400 }}>(all optional)</span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* The main notes box: most of what is said on the call lands here. */}
          {area("why_now", "WHAT IS GOING ON CURRENTLY", 10)}

          <div style={grid}>
            <label htmlFor="consult-search_goal" style={{ display: "block" }}>
              <span style={fieldLabel}>SEARCH GOAL</span>
              <select id="consult-search_goal" style={{ ...input, ...selectDarkInk }} value={form.live.search_goal} onChange={(e) => setLive("search_goal", e.target.value)}>
                <option value="" style={selectDarkOption}>Select…</option>
                {SEARCH_GOALS.map((g) => <option key={g} value={g} style={selectDarkOption}>{SEARCH_GOAL_LABEL[g]}</option>)}
              </select>
            </label>
            {form.live.search_goal === "other" && short("search_goal_other", "PLEASE SPECIFY")}
          </div>

          <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
            <legend style={fieldLabel}>SERVICES OF INTEREST</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px" }}>
              {SERVICES.map((s) => (
                <label key={s} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: T.TEXT, cursor: "pointer" }}>
                  <input type="checkbox" checked={form.services.includes(s)} onChange={() => toggleService(s)} />
                  {SERVICE_LABEL[s]}
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <span style={{ ...fieldLabel, marginBottom: 8 }}>TARGETS</span>
            <div style={grid}>
              {text("target_roles", "ROLES")}
              {text("target_industries", "INDUSTRIES")}
              {text("target_locations", "LOCATIONS")}
            </div>
          </div>

          <div>
            <span style={{ ...fieldLabel, marginBottom: 8 }}>TIMELINE</span>
            <div style={grid}>
              {short("timeline_deadlines", "DEADLINES")}
              {short("timeline_start", "START DATE")}
              {short("timeline_season", "RECRUITING SEASON")}
            </div>
          </div>

          {area("tried_so_far", "WHAT THEY'VE TRIED SO FAR")}

          <div>
            <span style={{ ...fieldLabel, marginBottom: 8 }}>CURRENT MATERIALS</span>
            <div style={grid}>
              {MATERIALS.map((m) => {
                const k = `material_${m}` as LiveField
                return (
                  <label key={m} htmlFor={`consult-${k}`} style={{ display: "block" }}>
                    <span style={fieldLabel}>{MATERIAL_LABEL[m].toUpperCase()}</span>
                    <select id={`consult-${k}`} style={{ ...input, ...selectDarkInk }} value={form.live[k]} onChange={(e) => setLive(k, e.target.value)}>
                      <option value="" style={selectDarkOption}>Not discussed</option>
                      {MATERIAL_STATES.map((st) => <option key={st} value={st} style={selectDarkOption}>{MATERIAL_STATE_LABEL[st]}</option>)}
                    </select>
                  </label>
                )
              })}
            </div>
          </div>

          {area("recommendation", "RECOMMENDATION (PACKAGE AND ANYTHING CUSTOM)")}
          {area("next_steps", "NEXT STEPS (WHAT I PROMISED AND WHEN)")}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void save()} disabled={saving || !dirty}
            style={{ ...btnPrimary, fontSize: 13, padding: "9px 18px", opacity: saving || !dirty ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}>
            {saving && <SavingSpinner size={10} />}
            {saving ? "Saving…" : "Save consult"}
          </button>
          {dirty && !saving && <span style={{ fontSize: 12, color: T.MUTED }}>Unsaved changes</span>}
          {saveMsg && <span role="status" style={{ fontSize: 12, fontWeight: 700, color: saveMsg.ok ? T.SUCCESS : T.ERROR }}>{saveMsg.text}</span>}
        </div>
      </section>

      {/* Outcome */}
      <section aria-label="Outcome" style={sectionStyle}>
        <div style={{ ...eyebrow, color: T.INK_EMPHASIS, marginBottom: 10 }}>OUTCOME</div>
        {closed ? (
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
            {p.prospect_status === "lost" ? "This prospect is marked lost. Reopen them on the prospect page to record an outcome." : "This prospect has been converted."}
          </p>
        ) : c.outcome ? (
          <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>
            Recorded: {OUTCOME_LABEL[c.outcome]}. Book the next consult on the prospect page to record another.
          </p>
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {(["completed", "no_show", "not_a_fit"] as const).map((o) => (
              <button key={o} type="button" onClick={() => { setOutcome(o); setMinutes(""); setPackageId(""); setNotFitNotes("") }}
                style={o === "completed" ? { ...btnPrimary, fontSize: 13, padding: "9px 16px" } : { ...btnSecondary, fontSize: 13, padding: "9px 16px" }}>
                {OUTCOME_LABEL[o]}
              </button>
            ))}
          </div>
        )}
      </section>

      {outcome && (
        <ChainConfirmDialog
          title={OUTCOME_LABEL[outcome]}
          steps={[
            ...(dirty ? ["Saves your unsaved consult notes first."] : []),
            ...data.outcome_chain[outcome].map((s) => fillName(s, p.name)),
          ]}
          confirmLabel="Confirm"
          danger={outcome === "not_a_fit"}
          canConfirm={outcome !== "completed" || !!packageId}
          onClose={() => setOutcome(null)}
          onConfirm={recordOutcome}
        >
          {outcome === "completed" && (
            <>
              <label htmlFor="outcome-package" style={{ display: "block" }}>
                <span style={fieldLabel}>PACKAGE</span>
                <select id="outcome-package" style={{ ...input, ...selectDarkInk }} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                  <option value="" style={selectDarkOption}>Pick a package…</option>
                  {data.packages.map((pk) => <option key={pk.id} value={pk.id} style={selectDarkOption}>{pk.name}</option>)}
                  <option value="custom" style={selectDarkOption}>Custom</option>
                </select>
              </label>
              <label htmlFor="outcome-minutes" style={{ display: "block" }}>
                <span style={fieldLabel}>TIME LOGGED, MINUTES <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span></span>
                <input id="outcome-minutes" type="number" min={0} max={1440} step={1} style={input} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              </label>
            </>
          )}
          {outcome === "not_a_fit" && (
            <label htmlFor="outcome-notes" style={{ display: "block" }}>
              <span style={fieldLabel}>NOTES <span style={{ color: T.DIM, fontWeight: 400 }}>(optional)</span></span>
              <textarea id="outcome-notes" style={{ ...textarea, minHeight: 70 }} value={notFitNotes} onChange={(e) => setNotFitNotes(e.target.value)} />
            </label>
          )}
        </ChainConfirmDialog>
      )}
    </div>
  )
}
