"use client"

// Phases: Settings > Services > Phases. Modelled on My Pipeline
// (settings/prospects/MyPipelineSection.tsx): the coach's phases in order,
// which they can rename, reorder, switch on or off, and add to. Phases are
// never deleted, so History keeps their names; switch one off instead.
// Each phase also carries its SOW text: a subtitle for the stage heading and an
// optional closing note shown under that stage.
//
// GET/PUT /api/coach/phases. The rules are in lib/phases/service.ts.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"
import { SavingSpinner } from "../../SavingSpinner"
import { PHASE_LABEL_MAX, type Phase } from "@/lib/phases/model"
import { SOW_NOTE_MAX, SOW_SUBTITLE_MAX } from "@/lib/sow/model"

async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await getSupabaseBrowser().auth.getSession()
  const token = session?.access_token || sessionStorage.getItem("signal_handoff_token")
  return fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  })
}

type Row = { id?: string; label: string; active: boolean; is_custom: boolean; sow_subtitle: string; sow_note: string }

const toRows = (list: Phase[]): Row[] => list.map((p) => ({
  id: p.id, label: p.label, active: p.active, is_custom: p.is_custom,
  sow_subtitle: p.sow_subtitle ?? "", sow_note: p.sow_note ?? "",
}))
const snapshot = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.id ?? `new:${r.label}`, r.label, r.active, r.sow_subtitle, r.sow_note]))

export function PhasesTab() {
  const [rows, setRows] = useState<Row[]>([])
  const [saved, setSaved] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newLabel, setNewLabel] = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await authFetch("/api/coach/phases")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Couldn't load phases (${res.status})`); return }
      setRows(toRows(j.phases))
      setSaved(toRows(j.phases))
    } catch {
      setError("Network error, try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => snapshot(rows) !== snapshot(saved), [rows, saved])
  const clear = () => { setError(null); setSavedOk(false) }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= rows.length) return
    setRows((prev) => { const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next })
    clear()
  }
  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
    clear()
  }
  function add() {
    const label = newLabel.trim()
    if (!label) return
    setRows((prev) => [...prev, { label, active: true, is_custom: true, sow_subtitle: "", sow_note: "" }])
    setNewLabel("")
    clear()
  }

  async function save() {
    if (rows.some((r) => !r.label.trim())) { setError("Every phase needs a name."); return }
    setSaving(true)
    clear()
    try {
      const res = await authFetch("/api/coach/phases", {
        method: "PUT",
        body: JSON.stringify({ phases: rows.map((r) => ({
          ...(r.id ? { id: r.id } : {}), label: r.label.trim(), active: r.active,
          sow_subtitle: r.sow_subtitle.trim() || null, sow_note: r.sow_note.trim() || null,
        })) }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) { setError(j?.error || `Save failed (${res.status})`); return }
      setRows(toRows(j.phases))
      setSaved(toRows(j.phases))
      setSavedOk(true)
    } catch {
      setError("Network error, try again")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your phases…</p>

  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        The phases every client moves through. Give each deliverable a phase, and a client&apos;s Phase
        stepper shows which phases their approved packages cover. Reorder or rename phases, switch off
        the ones you don&apos;t use, or add your own.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} data-testid="phase-row" style={{
            padding: "10px 12px", borderRadius: 12,
            border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS, opacity: r.active ? 1 : 0.55,
          }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 22 }}>
              <Arrow label={`Move ${r.label} up`} disabled={i === 0} onClick={() => move(i, -1)}>▲</Arrow>
              <Arrow label={`Move ${r.label} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>▼</Arrow>
            </div>
            <span style={{ fontSize: 11, color: T.DIM, width: 18, textAlign: "right" }}>{i + 1}</span>
            <input
              aria-label={`Phase ${i + 1} name`}
              value={r.label}
              maxLength={PHASE_LABEL_MAX}
              onChange={(e) => update(i, { label: e.target.value })}
              style={{ ...input, flex: 1, height: 34 }}
            />
            <button
              type="button"
              onClick={() => update(i, { active: !r.active })}
              aria-pressed={r.active}
              aria-label={`${r.label} ${r.active ? "active" : "off"}`}
              style={{
                background: r.active ? "rgba(0,179,179,0.12)" : T.NAV_DEFAULT_BG,
                border: `1px solid ${r.active ? "rgba(0,179,179,0.40)" : T.BORDER_SOFT}`,
                color: r.active ? T.SUCCESS : T.MUTED, borderRadius: 999, padding: "5px 12px",
                fontSize: 11, fontWeight: 800, cursor: "pointer", minWidth: 64,
              }}
            >
              {r.active ? "Active" : "Off"}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, paddingLeft: 52 }}>
            <input
              aria-label={`${r.label} SOW subtitle`}
              placeholder="SOW subtitle (optional), shown in the stage heading"
              value={r.sow_subtitle}
              maxLength={SOW_SUBTITLE_MAX}
              onChange={(e) => update(i, { sow_subtitle: e.target.value })}
              style={{ ...input, height: 32 }}
            />
            <textarea
              aria-label={`${r.label} SOW closing note`}
              placeholder="SOW closing note (optional), shown under this stage"
              value={r.sow_note}
              maxLength={SOW_NOTE_MAX}
              onChange={(e) => update(i, { sow_note: e.target.value })}
              style={{ ...input, minHeight: 52, resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }}
            />
          </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          aria-label="New phase name"
          value={newLabel}
          maxLength={PHASE_LABEL_MAX}
          onChange={(e) => { setNewLabel(e.target.value); clear() }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add() } }}
          placeholder="Add a phase…"
          style={{ ...input, flex: 1 }}
        />
        <button type="button" onClick={add} disabled={!newLabel.trim()} style={{ ...btnSecondary, opacity: newLabel.trim() ? 1 : 0.5, whiteSpace: "nowrap" }}>
          + Add phase
        </button>
      </div>

      {error && <div role="alert" style={{ marginTop: 16, fontSize: 12, color: T.ERROR }}>{error}</div>}
      {savedOk && <div role="status" style={{ marginTop: 16, fontSize: 12, color: T.SUCCESS }}>Phases saved.</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
        <button type="button" onClick={save} disabled={saving || !dirty} style={{
          ...btnPrimary, opacity: saving || !dirty ? 0.5 : 1, display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          {saving && <SavingSpinner size={10} />}
          {saving ? "Saving…" : "Save phases"}
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
