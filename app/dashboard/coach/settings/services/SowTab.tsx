"use client"

// SOW: Settings > Services > SOW. The practice's standard SOW sections
// (Included at no charge, Optional addition, How we work, Not included). Each
// line shows on every SOW, only when a phase is in the client's plan, or only
// when a phase is NOT in the plan. Deliverable bullets live on the Deliverables
// tab and phase subtitles and closing notes on the Phases tab.
//
// GET/PUT /api/coach/sow-lines. The rules are in lib/sow/service.ts.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { SavingSpinner } from "../../SavingSpinner"
import type { Phase } from "@/lib/phases/model"
import { SOW_LINE_MAX, SOW_SECTIONS, SOW_SECTION_LABEL, type SowLine, type SowSection } from "@/lib/sow/model"

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

// "Show for", as one select value: every, in:<phase id>, out:<phase id>.
type Row = { key: string; section: SowSection; body: string; show: string }

let seq = 0
const newKey = () => `row-${++seq}`
const showOf = (l: SowLine) =>
  l.show_for === "every_plan" || !l.phase_id ? "every" : `${l.show_for === "phase_in_plan" ? "in" : "out"}:${l.phase_id}`
const toRows = (lines: SowLine[]): Row[] => lines.map((l) => ({ key: newKey(), section: l.section, body: l.body, show: showOf(l) }))
const snapshot = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.section, r.body, r.show]))
const toPayload = (r: Row) => {
  const [mode, phaseId] = r.show.split(":")
  return {
    section: r.section,
    body: r.body.trim(),
    show_for: mode === "in" ? "phase_in_plan" : mode === "out" ? "phase_not_in_plan" : "every_plan",
    phase_id: mode === "every" ? null : phaseId,
  }
}

export function SowTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [saved, setSaved] = useState<Row[]>([])
  const [phases, setPhases] = useState<Phase[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/api/coach/sow-lines")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load the SOW sections (${res.status})`); return }
      const r = toRows(j.lines)
      setRows(r)
      setSaved(r)
      setPhases(j.phases)
    } catch {
      setError("Network error, try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => snapshot(rows) !== snapshot(saved), [rows, saved])
  const clear = () => { setError(null); setSavedOk(false) }

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
    clear()
  }
  function remove(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key))
    clear()
  }
  function add(section: SowSection) {
    setRows((prev) => [...prev, { key: newKey(), section, body: "", show: "every" }])
    clear()
  }
  // Move within the section: swap with the neighbouring line of the same section.
  function move(key: string, dir: -1 | 1) {
    setRows((prev) => {
      const i = prev.findIndex((r) => r.key === key)
      const same = prev.map((r, idx) => ({ r, idx })).filter(({ r }) => r.section === prev[i].section)
      const at = same.findIndex(({ idx }) => idx === i)
      const other = same[at + dir]
      if (!other) return prev
      const next = [...prev]
      ;[next[i], next[other.idx]] = [next[other.idx], next[i]]
      return next
    })
    clear()
  }

  async function save() {
    if (rows.some((r) => !r.body.trim())) { setError("Every line needs text. Remove empty lines."); return }
    setSaving(true)
    clear()
    try {
      const res = await authFetch("/api/coach/sow-lines", { method: "PUT", body: JSON.stringify({ lines: rows.map(toPayload) }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Save failed (${res.status})`); return }
      const r = toRows(j.lines)
      setRows(r)
      setSaved(r)
      setSavedOk(true)
    } catch {
      setError("Network error, try again")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your SOW sections…</p>

  // Phases a line can be tied to: the active ones, plus any a saved line already uses.
  const used = new Set(rows.map((r) => r.show.split(":")[1]).filter(Boolean))
  const choices = phases.filter((p) => p.active || used.has(p.id))

  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        The standard sections at the end of every client&apos;s SOW. A line can show on every SOW, only when a
        phase is in the client&apos;s plan, or only when it isn&apos;t. Deliverable bullets are on the Deliverables
        tab; phase subtitles and closing notes are on the Phases tab.
      </p>

      {SOW_SECTIONS.map((section) => {
        const lines = rows.filter((r) => r.section === section)
        return (
          <div key={section} data-testid={`sow-section-${section}`} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 8 }}>
              {SOW_SECTION_LABEL[section]}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.length === 0 && <p style={{ fontSize: 12, color: T.DIM, margin: 0 }}>No lines yet.</p>}
              {lines.map((r, i) => (
                <div key={r.key} data-testid="sow-line" style={{
                  display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 12,
                  border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
                }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 22, paddingTop: 4 }}>
                    <Arrow label="Move line up" disabled={i === 0} onClick={() => move(r.key, -1)}>▲</Arrow>
                    <Arrow label="Move line down" disabled={i === lines.length - 1} onClick={() => move(r.key, 1)}>▼</Arrow>
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                    <textarea
                      aria-label={`${SOW_SECTION_LABEL[section]} line ${i + 1}`}
                      value={r.body}
                      maxLength={SOW_LINE_MAX}
                      onChange={(e) => update(r.key, { body: e.target.value })}
                      style={{ ...input, minHeight: 44, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
                    />
                    <select
                      aria-label={`Show for, ${SOW_SECTION_LABEL[section]} line ${i + 1}`}
                      value={r.show}
                      onChange={(e) => update(r.key, { show: e.target.value })}
                      style={{ ...input, height: 32, maxWidth: 340 }}
                    >
                      <option value="every">Every plan</option>
                      {choices.map((p) => (
                        <option key={`in:${p.id}`} value={`in:${p.id}`}>Only when {p.label} is in the plan</option>
                      ))}
                      {choices.map((p) => (
                        <option key={`out:${p.id}`} value={`out:${p.id}`}>Only when {p.label} is NOT in the plan</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" aria-label={`Remove ${SOW_SECTION_LABEL[section]} line ${i + 1}`} onClick={() => remove(r.key)} style={{
                    background: "transparent", border: "none", color: T.MUTED, cursor: "pointer", fontSize: 14, padding: 4,
                  }}>✕</button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => add(section)} style={{ ...btnSecondary, marginTop: 8 }}>
              + Add line
            </button>
          </div>
        )
      })}

      {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: T.ERROR }}>{error}</div>}
      {savedOk && <div role="status" style={{ marginTop: 8, fontSize: 12, color: T.SUCCESS }}>SOW sections saved.</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 14, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={saving || !dirty} style={{
          ...btnPrimary, opacity: saving || !dirty ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          {saving && <SavingSpinner size={10} />}
          {saving ? "Saving…" : "Save SOW sections"}
        </button>
        {dirty && !saving && (
          <button type="button" onClick={() => { void load(); clear() }} style={{ ...btnSecondary }}>Discard changes</button>
        )}
      </div>
    </div>
  )
}

function Arrow({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} style={{
      background: "transparent", border: "none", color: disabled ? T.DIM : T.MUTED,
      cursor: disabled ? "default" : "pointer", fontSize: 10, lineHeight: "10px", padding: 2,
    }}>
      {children}
    </button>
  )
}
