"use client"

// My Pipeline — coach pipeline configuration section (spec §0.3, §8.1;
// extended in Step 4b with stage rename + custom-stage delete).
//
// Lives inside the My Settings sectioned shell. Lets a coach:
//   - see their configured stages in order (GET /api/coach/pipeline; the GET
//     lazy-seeds the 10 defaults + Convert for a new coach),
//   - toggle stages active/inactive (deselect — kept for history),
//   - reorder non-terminal stages (up/down arrows — robust, no drag dep),
//   - RENAME a stage inline (canned + custom). Renames are cosmetic: the
//     stage_key is immutable, so reporting is unaffected (Step 4b),
//   - add a custom stage (label input → appended before Convert),
//   - DELETE a custom stage. The server decides soft (active=false, if a
//     prospect reached it) vs hard (removed, if unused) — the UI just calls
//     delete and reflects the outcome (Step 4b),
//   - save the batch (order / toggle / rename / add) via PUT /api/coach/pipeline.
//
// The terminal Convert stage is pinned last, visually distinct, and fully
// non-editable in the UI (no toggle / no arrows / no rename / no delete),
// mirroring the server guards. Server validation + delete outcomes surface in
// inline banners rather than failing silently.

import { useCallback, useEffect, useMemo, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../lib/supabase-browser"
import { SavingSpinner } from "../SavingSpinner"

const LABEL_MAX = 60

// ── Auth (same inline pattern as the prospect pages) ──
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

type Stage = {
  // id/stage_key absent for not-yet-saved custom stages (server generates the
  // key on PUT). is_terminal rows are the Convert stage.
  id?: string
  stage_key?: string
  label: string
  is_custom: boolean
  is_terminal: boolean
  active: boolean
}

function fromApi(list: any[]): Stage[] {
  const next: Stage[] = (list || []).map((s: any) => ({
    id: s.id,
    stage_key: s.stage_key,
    label: s.label,
    is_custom: !!s.is_custom,
    is_terminal: !!s.is_terminal,
    active: !!s.active,
  }))
  // Defensive: terminal always last (API already orders by sort_order).
  next.sort((a, b) => Number(a.is_terminal) - Number(b.is_terminal))
  return next
}

// Normalized projection for dirty-checking (order + active + label + identity).
function snapshot(stages: Stage[]): string {
  return JSON.stringify(stages.map((s) => [s.stage_key ?? `new:${s.label}`, s.label, s.active, s.is_custom]))
}

export function MyPipelineSection() {
  const [stages, setStages] = useState<Stage[]>([])
  // savedStages = the authoritative persisted set. Kept as an array (not a
  // snapshot string) so an immediate custom-delete can be applied to both
  // `stages` and `savedStages` without clobbering unsaved renames/reorders.
  const [savedStages, setSavedStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedOk, setSavedOk] = useState(false)
  const [infoMsg, setInfoMsg] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState("")
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editValue, setEditValue] = useState("")
  const [deletingKey, setDeletingKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch("/api/coach/pipeline")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load pipeline (${res.status})`)
        return
      }
      const next = fromApi(j.stages)
      setStages(next)
      setSavedStages(next.map((s) => ({ ...s })))
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const dirty = useMemo(() => snapshot(stages) !== snapshot(savedStages), [stages, savedStages])

  // Index of the last non-terminal stage (arrows operate within [0, lastNonTerminal]).
  const lastNonTerminalIdx = useMemo(() => {
    let idx = -1
    stages.forEach((s, i) => { if (!s.is_terminal) idx = i })
    return idx
  }, [stages])

  function clearStatus() { setSaveError(null); setSavedOk(false); setInfoMsg(null) }
  function cancelEdit() { setEditingIdx(null); setEditValue("") }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j > lastNonTerminalIdx) return
    if (stages[i].is_terminal || stages[j].is_terminal) return
    cancelEdit()
    setStages((prev) => {
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    clearStatus()
  }

  function toggleActive(i: number) {
    if (stages[i].is_terminal) return
    cancelEdit()
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, active: !s.active } : s)))
    clearStatus()
  }

  function startEdit(i: number) {
    if (stages[i].is_terminal) return
    clearStatus()
    setEditingIdx(i)
    setEditValue(stages[i].label)
  }

  function commitEdit() {
    if (editingIdx === null) return
    const trimmed = editValue.trim()
    if (!trimmed) { cancelEdit(); return }
    if (trimmed.length > LABEL_MAX) { setSaveError(`Stage label too long (max ${LABEL_MAX})`); return }
    const i = editingIdx
    setStages((prev) => prev.map((s, idx) => (idx === i ? { ...s, label: trimmed } : s)))
    cancelEdit()
    clearStatus()
  }

  function addCustom() {
    const label = newLabel.trim()
    if (!label) return
    if (label.length > LABEL_MAX) { setSaveError(`Stage label too long (max ${LABEL_MAX})`); return }
    cancelEdit()
    setStages((prev) => {
      const next = [...prev]
      const insertAt = next.findIndex((s) => s.is_terminal)
      const stage: Stage = { label, is_custom: true, is_terminal: false, active: true }
      if (insertAt === -1) next.push(stage)
      else next.splice(insertAt, 0, stage)
      return next
    })
    setNewLabel("")
    clearStatus()
  }

  // Delete a custom stage. Unsaved custom (no stage_key) → local remove. A
  // persisted custom → DELETE endpoint; the server decides soft vs hard and we
  // reflect that (soft = stays as inactive/dimmed, with a note explaining why).
  async function deleteStage(i: number) {
    const s = stages[i]
    if (s.is_terminal || !s.is_custom) return
    cancelEdit()
    clearStatus()
    if (!s.stage_key) {
      setStages((prev) => prev.filter((_, idx) => idx !== i))
      return
    }
    const key = s.stage_key
    setDeletingKey(key)
    try {
      const res = await authFetch(`/api/coach/pipeline?stage_key=${encodeURIComponent(key)}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setSaveError(j?.error || `Delete failed (${res.status})`)
        return
      }
      if (j.deleted === "hard") {
        setStages((prev) => prev.filter((x) => x.stage_key !== key))
        setSavedStages((prev) => prev.filter((x) => x.stage_key !== key))
      } else {
        // Soft delete — mark inactive in both authoritative + working state so
        // the row stays (dimmed) and the delete itself isn't treated as dirty.
        setStages((prev) => prev.map((x) => (x.stage_key === key ? { ...x, active: false } : x)))
        setSavedStages((prev) => prev.map((x) => (x.stage_key === key ? { ...x, active: false } : x)))
        setInfoMsg(`“${s.label}” was kept as inactive because a prospect already reached it.`)
      }
    } catch {
      setSaveError("Network error — try again")
    } finally {
      setDeletingKey(null)
    }
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    setSavedOk(false)
    setInfoMsg(null)
    cancelEdit()
    try {
      // sort_order = display index + 1 (terminal is last in the array → highest).
      const payload = {
        stages: stages.map((s, i) => {
          if (!s.stage_key) {
            return { is_custom: true, label: s.label, sort_order: i + 1 }
          }
          // label sent for canned + custom now (rename is cosmetic; key fixed).
          const base: any = { stage_key: s.stage_key, sort_order: i + 1, active: s.active }
          if (!s.is_terminal) base.label = s.label
          return base
        }),
      }
      const res = await authFetch("/api/coach/pipeline", {
        method: "PUT",
        body: JSON.stringify(payload),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setSaveError(j?.error || `Save failed (${res.status})`)
        return
      }
      const next = fromApi(j.stages)
      setStages(next)
      setSavedStages(next.map((s) => ({ ...s })))
      setSavedOk(true)
    } catch {
      setSaveError("Network error — try again")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your pipeline…</p>
  }
  if (loadError) {
    return (
      <div>
        <Banner kind="error">{loadError}</Banner>
        <button style={{ ...btnSecondary, marginTop: 12 }} onClick={() => void load()}>Retry</button>
      </div>
    )
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: T.MUTED, margin: "0 0 16px" }}>
        These are the stages every prospect moves through. Reorder them, rename them,
        switch off the ones you don’t use, or add your own. The final{" "}
        <strong style={{ color: T.TEXT }}>Convert to Client</strong> stage is always last
        and can’t be changed.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {stages.map((s, i) => (
          <StageRow
            key={s.stage_key ?? `new-${i}`}
            stage={s}
            position={i + 1}
            canMoveUp={!s.is_terminal && i > 0}
            canMoveDown={!s.is_terminal && i < lastNonTerminalIdx}
            editing={editingIdx === i}
            editValue={editValue}
            deleting={!!s.stage_key && deletingKey === s.stage_key}
            onUp={() => move(i, -1)}
            onDown={() => move(i, 1)}
            onToggle={() => toggleActive(i)}
            onStartEdit={() => startEdit(i)}
            onEditChange={setEditValue}
            onEditCommit={commitEdit}
            onEditCancel={cancelEdit}
            onDelete={() => deleteStage(i)}
          />
        ))}
      </div>

      {/* Add custom stage */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={newLabel}
          onChange={(e) => { setNewLabel(e.target.value); clearStatus() }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom() } }}
          placeholder="Add a custom stage…"
          maxLength={LABEL_MAX}
          style={{ ...input, flex: 1 }}
        />
        <button
          onClick={addCustom}
          disabled={!newLabel.trim()}
          style={{ ...btnSecondary, opacity: newLabel.trim() ? 1 : 0.5, cursor: newLabel.trim() ? "pointer" : "default", whiteSpace: "nowrap" }}
        >
          + Add stage
        </button>
      </div>

      {/* Status banners */}
      {saveError && <div style={{ marginTop: 16 }}><Banner kind="error">{saveError}</Banner></div>}
      {savedOk && <div style={{ marginTop: 16 }}><Banner kind="success">Pipeline saved.</Banner></div>}
      {infoMsg && <div style={{ marginTop: 16 }}><Banner kind="info">{infoMsg}</Banner></div>}

      {/* Save / Discard */}
      <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
        <button
          onClick={save}
          disabled={saving || !dirty}
          style={{
            ...btnPrimary,
            opacity: saving || !dirty ? 0.5 : 1,
            cursor: saving || !dirty ? "default" : "pointer",
            display: "inline-flex", alignItems: "center", gap: 6,
          }}
        >
          {saving && <SavingSpinner size={10} />}
          {saving ? "Saving…" : "Save pipeline"}
        </button>
        {dirty && !saving && (
          <button onClick={() => { void load(); clearStatus() }} style={{ ...btnSecondary }}>
            Discard changes
          </button>
        )}
      </div>
    </div>
  )
}

// ── Row ──
function StageRow({
  stage, position, canMoveUp, canMoveDown, editing, editValue, deleting,
  onUp, onDown, onToggle, onStartEdit, onEditChange, onEditCommit, onEditCancel, onDelete,
}: {
  stage: Stage
  position: number
  canMoveUp: boolean
  canMoveDown: boolean
  editing: boolean
  editValue: string
  deleting: boolean
  onUp: () => void
  onDown: () => void
  onToggle: () => void
  onStartEdit: () => void
  onEditChange: (v: string) => void
  onEditCommit: () => void
  onEditCancel: () => void
  onDelete: () => void
}) {
  const terminal = stage.is_terminal
  const dim = !terminal && !stage.active
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${terminal ? T.NAV_ACTIVE_BORDER : T.BORDER_SOFT}`,
        background: terminal ? "rgba(33,140,140,0.10)" : T.GLASS,
        opacity: dim ? 0.55 : 1,
      }}
    >
      {/* Reorder arrows (hidden for terminal) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, width: 22 }}>
        {!terminal ? (
          <>
            <ArrowBtn dir="up" disabled={!canMoveUp || editing} onClick={onUp} />
            <ArrowBtn dir="down" disabled={!canMoveDown || editing} onClick={onDown} />
          </>
        ) : (
          <span aria-hidden style={{ fontSize: 12, color: T.WRN_TEAL, textAlign: "center" }}>🔒</span>
        )}
      </div>

      <span style={{ fontSize: 11, color: T.DIM, width: 18, textAlign: "right" }}>{position}</span>

      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div>
            <input
              autoFocus
              value={editValue}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); onEditCommit() }
                if (e.key === "Escape") { e.preventDefault(); onEditCancel() }
              }}
              onBlur={onEditCommit}
              maxLength={LABEL_MAX}
              style={{ ...input, height: 34 }}
            />
            {!stage.is_custom && (
              <span style={{ fontSize: 10, color: T.DIM, display: "block", marginTop: 4 }}>
                Cosmetic only — reporting still uses the original stage.
              </span>
            )}
          </div>
        ) : (
          <span style={{ fontSize: 13, color: T.TEXT, fontWeight: terminal ? 800 : 500 }}>
            {stage.label}
          </span>
        )}
        {!editing && stage.is_custom && <Tag color={T.WRN_BLUE}>custom</Tag>}
        {!editing && terminal && <Tag color={T.WRN_TEAL}>always last</Tag>}
      </div>

      {/* Edit / delete controls (none for terminal) */}
      {!terminal && !editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <IconBtn label="Rename" onClick={onStartEdit}>✎</IconBtn>
          {stage.is_custom && (
            deleting
              ? <SavingSpinner size={10} />
              : <IconBtn label="Delete stage" danger onClick={onDelete}>🗑</IconBtn>
          )}
        </div>
      )}

      {/* Active toggle (terminal shows a static, non-interactive marker) */}
      {terminal ? (
        <span style={{ fontSize: 11, color: T.WRN_TEAL, fontWeight: 800, whiteSpace: "nowrap" }}>
          Convert
        </span>
      ) : (
        <button
          onClick={onToggle}
          disabled={editing}
          style={{
            background: stage.active ? "rgba(74,222,128,0.12)" : T.NAV_DEFAULT_BG,
            border: `1px solid ${stage.active ? "rgba(74,222,128,0.40)" : T.BORDER_SOFT}`,
            color: stage.active ? T.SUCCESS : T.MUTED,
            borderRadius: 999,
            padding: "5px 12px",
            fontSize: 11,
            fontWeight: 800,
            cursor: editing ? "default" : "pointer",
            opacity: editing ? 0.5 : 1,
            whiteSpace: "nowrap",
            minWidth: 64,
          }}
        >
          {stage.active ? "Active" : "Off"}
        </button>
      )}
    </div>
  )
}

function ArrowBtn({ dir, disabled, onClick }: { dir: "up" | "down"; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "up" ? "Move up" : "Move down"}
      style={{
        background: "transparent",
        border: "none",
        color: disabled ? T.DIM : T.MUTED,
        cursor: disabled ? "default" : "pointer",
        fontSize: 10,
        lineHeight: "10px",
        padding: 2,
      }}
    >
      {dir === "up" ? "▲" : "▼"}
    </button>
  )
}

function IconBtn({ children, label, danger, onClick }: { children: React.ReactNode; label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        background: "transparent",
        border: `1px solid ${T.BORDER_SOFT}`,
        color: danger ? T.ERROR : T.MUTED,
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 12,
        lineHeight: "12px",
        padding: "6px 8px",
      }}
    >
      {children}
    </button>
  )
}

function Tag({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 9,
        fontWeight: 900,
        letterSpacing: 1,
        textTransform: "uppercase",
        color,
        border: `1px solid ${color}`,
        borderRadius: 6,
        padding: "1px 5px",
        verticalAlign: "middle",
      }}
    >
      {children}
    </span>
  )
}

function Banner({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const palette =
    kind === "error"
      ? { color: T.ERROR, bg: T.ERROR_BG, border: "rgba(255,120,120,0.30)" }
      : kind === "success"
      ? { color: T.SUCCESS, bg: T.SUCCESS_BG, border: "rgba(74,222,128,0.30)" }
      : { color: T.WRN_BLUE, bg: "rgba(81,173,229,0.10)", border: "rgba(81,173,229,0.30)" }
  return (
    <div
      style={{
        fontSize: 12,
        color: palette.color,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 10,
        padding: "10px 12px",
      }}
    >
      {children}
    </div>
  )
}
