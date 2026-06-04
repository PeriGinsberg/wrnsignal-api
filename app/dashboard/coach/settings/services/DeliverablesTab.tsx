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

  // Create form.
  const [cName, setCName] = useState("")
  const [cDesc, setCDesc] = useState("")
  const [cCat, setCCat] = useState("")
  const [creating, setCreating] = useState(false)

  // Inline edit.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [eName, setEName] = useState("")
  const [eDesc, setEDesc] = useState("")
  const [eCat, setECat] = useState("")
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
    setCreating(true)
    setActionError(null)
    try {
      const res = await authFetch("/api/coach/milestones", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: cDesc.trim() || undefined,
          category: cCat.trim() || undefined,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j?.ok) {
        setActionError(j?.error || `Create failed (${res.status})`)
        await resync()
        return
      }
      setItems((prev) => [...prev, j.milestone as Milestone])
      setCName(""); setCDesc(""); setCCat("")
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
  }
  function cancelEdit() {
    setEditingId(null)
    setEName(""); setEDesc(""); setECat("")
  }

  async function saveEdit(id: string) {
    const name = eName.trim()
    if (!name) { setActionError("Name cannot be empty"); return }
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
        setActionError(j?.error || `Delete failed (${res.status})`)
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
                  onName={setEName} onDescription={setEDesc} onCategory={setECat}
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
          onName={setCName} onDescription={setCDesc} onCategory={setCCat}
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

// ── Shared create/edit form (3 fields; Enter submits when valid) ──
function DeliverableForm({
  name, description, category,
  onName, onDescription, onCategory,
  onSubmit, submitLabel, busy, onCancel,
}: {
  name: string
  description: string
  category: string
  onName: (v: string) => void
  onDescription: (v: string) => void
  onCategory: (v: string) => void
  onSubmit: () => void
  submitLabel: string
  busy: boolean
  onCancel?: () => void
}) {
  const canSubmit = !!name.trim() && !busy
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
