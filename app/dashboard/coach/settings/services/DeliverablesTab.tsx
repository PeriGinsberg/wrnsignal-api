"use client"

// Deliverables tab content — the coach's milestones catalog (Services →
// Deliverables). Lists / creates / edits / deletes / toggles milestones against
// the per-row CRUD API:
//   GET    /api/coach/milestones
//   POST   /api/coach/milestones
//   PATCH  /api/coach/milestones/[id]
//   DELETE /api/coach/milestones/[id]
//
// Per-row immediate REST (not a batch save). Optimistic on success; on ANY write
// failure we show an inline banner AND refetch the list (resync) so local state
// can never diverge from server truth — the active toggle in particular snaps
// back. Rendered inside a single <SettingsBlock title="Deliverables"> by
// ServicesTabs (this component owns the rows + forms, not the card).
//
// getToken/authFetch are inlined per the coach-route client convention (same
// pair as MyPipelineSection); there is no shared helper module.

import { useCallback, useEffect, useState } from "react"
import { T, input, btnPrimary, btnSecondary } from "../../../../../lib/dashboard-theme"
import { getSupabaseBrowser } from "../../../../../lib/supabase-browser"

const NAME_MAX = 120

type Milestone = {
  id: string
  name: string
  description: string | null
  category: string | null
  sort_order: number
  active: boolean
  // time_estimate_days: fractional days OK. fee: DOLLARS (the API converts
  // to/from cents). Both null = unset; fee 0 = priced free (≠ unset).
  time_estimate_days: number | null
  fee: number | null
}

// Parse an optional numeric form field (time in days, or fee in dollars).
// Empty/whitespace → null (unset, NOT 0). Otherwise must be a finite number ≥ 0.
function parseOptionalNonNegNumber(raw: string): { value: number | null } | { error: string } {
  const s = raw.trim()
  if (!s) return { value: null }
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return { error: "Must be a number ≥ 0" }
  return { value: n }
}

// Fee in dollars → display. null = unset (render nothing). 0 = "Free" (distinct
// from unset). Otherwise "$150" or "$150.50" (2 decimals only when needed).
function formatFee(fee: number | null): string | null {
  if (fee === null) return null
  if (fee === 0) return "Free"
  return Number.isInteger(fee) ? `$${fee}` : `$${fee.toFixed(2)}`
}

// Days → display. null = unset (render nothing). "1 day" / "1.5 days".
function formatTime(days: number | null): string | null {
  if (days === null) return null
  return `${days} ${days === 1 ? "day" : "days"}`
}

// ── Auth (same inline pattern as MyPipelineSection) ──
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

export function DeliverablesTab() {
  const [items, setItems] = useState<Milestone[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // One banner for all write failures (create/edit/delete/toggle).
  const [actionError, setActionError] = useState<string | null>(null)

  // Create form. Time/fee held as strings (raw input); parsed at submit.
  const [cName, setCName] = useState("")
  const [cDesc, setCDesc] = useState("")
  const [cCat, setCCat] = useState("")
  const [cTime, setCTime] = useState("")
  const [cFee, setCFee] = useState("")
  const [creating, setCreating] = useState(false)

  // Inline edit.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [eName, setEName] = useState("")
  const [eDesc, setEDesc] = useState("")
  const [eCat, setECat] = useState("")
  const [eTime, setETime] = useState("")
  const [eFee, setEFee] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  // Delete confirm + in-flight markers.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await authFetch("/api/coach/milestones")
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setLoadError(j?.error || `Couldn't load deliverables (${res.status})`)
        return
      }
      setItems(j.milestones || [])
    } catch {
      setLoadError("Network error — try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Silent re-fetch used to resync after a write error (no full-screen loading
  // flip — the list stays visible and is corrected to server truth).
  const resync = useCallback(async () => {
    try {
      const res = await authFetch("/api/coach/milestones")
      const j = await res.json().catch(() => ({}))
      if (res.ok && j?.ok) setItems(j.milestones || [])
    } catch {
      /* leave the action banner as the surfaced error */
    }
  }, [])

  async function handleCreate() {
    const name = cName.trim()
    if (!name || creating) return
    // Mirror the API: time/fee, if filled, must be a number ≥ 0. Empty → null
    // (unset), never 0 or "".
    const timeParsed = parseOptionalNonNegNumber(cTime)
    if ("error" in timeParsed) { setActionError(`Time estimate: ${timeParsed.error}`); return }
    const feeParsed = parseOptionalNonNegNumber(cFee)
    if ("error" in feeParsed) { setActionError(`Fee: ${feeParsed.error}`); return }
    setCreating(true)
    setActionError(null)
    try {
      const res = await authFetch("/api/coach/milestones", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: cDesc.trim() || undefined,
          category: cCat.trim() || undefined,
          time_estimate_days: timeParsed.value, // null when unset
          fee: feeParsed.value,                 // dollars; null = unpriced
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Create failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => [...prev, j.milestone as Milestone])
      setCName(""); setCDesc(""); setCCat(""); setCTime(""); setCFee("")
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setCreating(false)
    }
  }

  function startEdit(m: Milestone) {
    setActionError(null)
    setConfirmDeleteId(null)
    setEditingId(m.id)
    setEName(m.name)
    setEDesc(m.description ?? "")
    setECat(m.category ?? "")
    // Pre-fill the DOLLAR value (m.fee is already dollars), not cents.
    setETime(m.time_estimate_days != null ? String(m.time_estimate_days) : "")
    setEFee(m.fee != null ? String(m.fee) : "")
  }
  function cancelEdit() {
    setEditingId(null)
    setEName(""); setEDesc(""); setECat(""); setETime(""); setEFee("")
  }

  async function saveEdit(id: string) {
    const name = eName.trim()
    if (!name) { setActionError("Name cannot be empty"); return }
    const timeParsed = parseOptionalNonNegNumber(eTime)
    if ("error" in timeParsed) { setActionError(`Time estimate: ${timeParsed.error}`); return }
    const feeParsed = parseOptionalNonNegNumber(eFee)
    if ("error" in feeParsed) { setActionError(`Fee: ${feeParsed.error}`); return }
    if (savingEdit) return
    setSavingEdit(true)
    setActionError(null)
    try {
      const res = await authFetch(`/api/coach/milestones/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: eDesc.trim() ? eDesc.trim() : null,
          category: eCat.trim() ? eCat.trim() : null,
          time_estimate_days: timeParsed.value, // null clears it
          fee: feeParsed.value,                 // dollars; null = unpriced
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Save failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => prev.map((m) => (m.id === id ? (j.milestone as Milestone) : m)))
      cancelEdit()
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setSavingEdit(false)
    }
  }

  async function toggleActive(m: Milestone) {
    if (togglingId) return
    setTogglingId(m.id)
    setActionError(null)
    const next = !m.active
    // Optimistic flip.
    setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, active: next } : x)))
    try {
      const res = await authFetch(`/api/coach/milestones/${m.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: next }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Couldn't update (${res.status})`)
        await resync() // snaps the toggle back to server truth
        return
      }
      setItems((prev) => prev.map((x) => (x.id === m.id ? (j.milestone as Milestone) : x)))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setTogglingId(null)
    }
  }

  async function confirmDelete(id: string) {
    if (deletingId) return
    setDeletingId(id)
    setActionError(null)
    try {
      const res = await authFetch(`/api/coach/milestones/${id}`, { method: "DELETE" })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        // 409 = used in one or more packages. Surface which ones so the coach
        // knows why the delete was blocked (and where to unlink it first).
        if (res.status === 409 && Array.isArray(j?.packages) && j.packages.length) {
          const names = (j.packages as string[]).map((n) => `“${n}”`).join(", ")
          setActionError(`${j.error || "This deliverable is used in a package."} Used in: ${names}.`)
        } else {
          setActionError(j?.error || `Delete failed (${res.status})`)
        }
        await resync()
        return
      }
      setItems((prev) => prev.filter((m) => m.id !== id))
    } catch {
      setActionError("Network error — try again")
      await resync()
    } finally {
      setDeletingId(null)
      setConfirmDeleteId(null)
    }
  }

  if (loading) {
    return <p style={{ fontSize: 13, color: T.MUTED, margin: 0 }}>Loading your deliverables…</p>
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
        Your catalog of deliverables — the services you offer. You&apos;ll assign these to
        prospects and clients (and bundle them into packages) later.
      </p>

      {actionError && (
        <div style={{ marginBottom: 16 }}><Banner kind="error">{actionError}</Banner></div>
      )}

      {items.length === 0 ? (
        <p style={{ fontSize: 13, color: T.DIM, margin: "0 0 16px" }}>
          No deliverables yet — add your first one below.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
          {items.map((m) =>
            editingId === m.id ? (
              <div
                key={m.id}
                style={{ padding: 12, borderRadius: 12, border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS }}
              >
                <DeliverableForm
                  name={eName} description={eDesc} category={eCat}
                  timeEstimate={eTime} fee={eFee}
                  onName={setEName} onDescription={setEDesc} onCategory={setECat}
                  onTimeEstimate={setETime} onFee={setEFee}
                  onSubmit={() => void saveEdit(m.id)} submitLabel="Save"
                  busy={savingEdit} onCancel={cancelEdit}
                />
              </div>
            ) : (
              <Row
                key={m.id}
                m={m}
                toggling={togglingId === m.id}
                deleting={deletingId === m.id}
                confirming={confirmDeleteId === m.id}
                onToggle={() => void toggleActive(m)}
                onEdit={() => startEdit(m)}
                onAskDelete={() => { setActionError(null); setConfirmDeleteId(m.id) }}
                onConfirmDelete={() => void confirmDelete(m.id)}
                onCancelDelete={() => setConfirmDeleteId(null)}
              />
            )
          )}
        </div>
      )}

      {/* Create form — always visible; doubles as the empty-state CTA. */}
      <div style={{ paddingTop: 16, borderTop: `1px solid ${T.BORDER_SOFT}` }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.DIM, marginBottom: 10 }}>
          Add a deliverable
        </div>
        <DeliverableForm
          name={cName} description={cDesc} category={cCat}
          timeEstimate={cTime} fee={cFee}
          onName={setCName} onDescription={setCDesc} onCategory={setCCat}
          onTimeEstimate={setCTime} onFee={setCFee}
          onSubmit={() => void handleCreate()} submitLabel="+ Add deliverable"
          busy={creating}
        />
      </div>
    </div>
  )
}

// ── Display row ──
function Row({
  m, toggling, deleting, confirming,
  onToggle, onEdit, onAskDelete, onConfirmDelete, onCancelDelete,
}: {
  m: Milestone
  toggling: boolean
  deleting: boolean
  confirming: boolean
  onToggle: () => void
  onEdit: () => void
  onAskDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
}) {
  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 12px", borderRadius: 12,
        border: `1px solid ${T.BORDER_SOFT}`, background: T.GLASS,
        opacity: m.active ? 1 : 0.55,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <span style={{ fontSize: 14, color: T.TEXT, fontWeight: 600 }}>{m.name}</span>
          {m.category && (
            <span style={{ fontSize: 9, fontWeight: 900, letterSpacing: 1, textTransform: "uppercase", color: T.WRN_BLUE, border: `1px solid ${T.WRN_BLUE}`, borderRadius: 6, padding: "1px 5px" }}>
              {m.category}
            </span>
          )}
        </div>
        {m.description && (
          <div style={{ fontSize: 12, color: T.MUTED, marginTop: 3 }}>{m.description}</div>
        )}
        {(() => {
          const feeLabel = formatFee(m.fee)
          const timeLabel = formatTime(m.time_estimate_days)
          if (!feeLabel && !timeLabel) return null
          return (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4, fontSize: 12 }}>
              {feeLabel && <span style={{ color: T.TEXT, fontWeight: 700 }}>{feeLabel}</span>}
              {timeLabel && <span style={{ color: T.MUTED }}>{timeLabel}</span>}
            </div>
          )
        })()}
      </div>

      {confirming ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: T.MUTED }}>Delete this deliverable?</span>
          <button onClick={onConfirmDelete} disabled={deleting} style={{ ...smallBtn, color: T.ERROR, borderColor: "rgba(255,120,120,0.4)", opacity: deleting ? 0.6 : 1 }}>
            {deleting ? "Deleting…" : "Delete"}
          </button>
          <button onClick={onCancelDelete} disabled={deleting} style={smallBtn}>Cancel</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={onToggle}
            disabled={toggling}
            style={{
              background: m.active ? "rgba(74,222,128,0.12)" : T.NAV_DEFAULT_BG,
              border: `1px solid ${m.active ? "rgba(74,222,128,0.40)" : T.BORDER_SOFT}`,
              color: m.active ? T.SUCCESS : T.MUTED,
              borderRadius: 999, padding: "5px 12px", fontSize: 11, fontWeight: 800,
              cursor: toggling ? "default" : "pointer", opacity: toggling ? 0.6 : 1,
              minWidth: 64, whiteSpace: "nowrap",
            }}
          >
            {m.active ? "Active" : "Off"}
          </button>
          <button onClick={onEdit} style={smallBtn}>Edit</button>
          <button onClick={onAskDelete} style={{ ...smallBtn, color: T.ERROR }}>Delete</button>
        </div>
      )}
    </div>
  )
}

// ── Shared create/edit form (name/desc/category + time/fee; Enter submits) ──
function DeliverableForm({
  name, description, category, timeEstimate, fee,
  onName, onDescription, onCategory, onTimeEstimate, onFee,
  onSubmit, submitLabel, busy, onCancel,
}: {
  name: string
  description: string
  category: string
  timeEstimate: string
  fee: string
  onName: (v: string) => void
  onDescription: (v: string) => void
  onCategory: (v: string) => void
  onTimeEstimate: (v: string) => void
  onFee: (v: string) => void
  onSubmit: () => void
  submitLabel: string
  busy: boolean
  onCancel?: () => void
}) {
  // Inline validation mirrors the API (number ≥ 0); empty is valid (unset).
  const timeCheck = parseOptionalNonNegNumber(timeEstimate)
  const feeCheck = parseOptionalNonNegNumber(fee)
  const timeErr = "error" in timeCheck ? timeCheck.error : null
  const feeErr = "error" in feeCheck ? feeCheck.error : null
  const canSubmit = !!name.trim() && !busy && !timeErr && !feeErr
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); if (canSubmit) onSubmit() }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        style={input}
        placeholder="Name (required)"
        value={name}
        maxLength={NAME_MAX}
        onChange={(e) => onName(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={!!onCancel}
      />
      <input
        style={input}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => onDescription(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <input
        style={input}
        placeholder="Category (optional)"
        value={category}
        onChange={(e) => onCategory(e.target.value)}
        onKeyDown={onKeyDown}
      />

      {/* Time + fee, side by side; both optional. */}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={fieldLabel}>Time estimate (days)</label>
          <input
            style={input}
            type="number" min="0" step="any" inputMode="decimal"
            placeholder="1.5"
            value={timeEstimate}
            onChange={(e) => onTimeEstimate(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {timeErr && <span style={fieldError}>{timeErr}</span>}
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={fieldLabel}>Fee (a la carte)</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: 0, height: 44, display: "flex", alignItems: "center", fontSize: 13, color: T.MUTED, pointerEvents: "none" }}>$</span>
            <input
              style={{ ...input, paddingLeft: 24 }}
              type="number" min="0" step="any" inputMode="decimal"
              placeholder="150"
              value={fee}
              onChange={(e) => onFee(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          {feeErr && <span style={fieldError}>{feeErr}</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onSubmit}
          disabled={!canSubmit}
          style={{ ...btnPrimary, opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "default" }}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel && <button onClick={onCancel} disabled={busy} style={btnSecondary}>Cancel</button>}
      </div>
    </div>
  )
}

const fieldLabel: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
  textTransform: "uppercase", color: T.DIM,
}
const fieldError: React.CSSProperties = { fontSize: 11, color: T.ERROR }

const smallBtn: React.CSSProperties = {
  background: "transparent",
  border: `1px solid ${T.BORDER_SOFT}`,
  color: T.MUTED,
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  padding: "6px 10px",
}

function Banner({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const palette =
    kind === "error"
      ? { color: T.ERROR, bg: T.ERROR_BG, border: "rgba(255,120,120,0.30)" }
      : kind === "success"
      ? { color: T.SUCCESS, bg: T.SUCCESS_BG, border: "rgba(74,222,128,0.30)" }
      : { color: T.WRN_BLUE, bg: "rgba(81,173,229,0.10)", border: "rgba(81,173,229,0.30)" }
  return (
    <div style={{ fontSize: 12, color: palette.color, background: palette.bg, border: `1px solid ${palette.border}`, borderRadius: 10, padding: "10px 12px" }}>
      {children}
    </div>
  )
}
